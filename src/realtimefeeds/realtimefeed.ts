import WebSocket, { createWebSocketStream } from 'ws'
import type { ClientRequestArgs } from 'http'
import { PassThrough, Writable } from 'stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { createDebug, type DebugLogger } from '../debug.ts'
import { getProxyAgent, ONE_SEC_IN_MS, optimizeFilters } from '../handy.ts'
import { createManagedRealTimeIterator, mergeRealTime, type ManagedRealTimeIterator } from '../realtimeiterator.ts'
import { Exchange, Filter } from '../types.ts'

export type RealTimeFeed = {
  new (
    exchange: Exchange,
    filters: Filter<string>[],
    timeoutIntervalMS: number | undefined,
    onError?: (error: Error) => void
  ): RealTimeFeedIterable
}

let connectionCounter = 1

export type RealTimeFeedIterable = AsyncIterable<any>

type RealTimeFeedConnection = {
  id: number
  ws: WebSocket
  controller: AbortController
  receivedMessagesCount: number
}

const ABORTED = Symbol('aborted')

export abstract class RealTimeFeedBase implements RealTimeFeedIterable {
  [Symbol.asyncIterator](): ManagedRealTimeIterator<any> {
    return createManagedRealTimeIterator(this._stream(), () => this._close())
  }

  protected readonly debug: DebugLogger
  protected abstract readonly wssURL: string
  protected readonly throttleSubscribeMS: number = 0
  protected readonly manualSnapshotsBuffer: any[] = []
  private readonly _filters: Filter<string>[]
  private _wsClientOptions: WebSocket.ClientOptions | ClientRequestArgs
  private _closed = false
  private readonly _closeController = new AbortController()
  private _connection?: RealTimeFeedConnection
  protected readonly originHeader: string | undefined = undefined
  protected readonly extraHeaders: Record<string, string> | undefined = undefined

  constructor(
    protected readonly _exchange: string,
    filters: Filter<string>[],
    private readonly _timeoutIntervalMS: number | undefined,
    private readonly _onError?: (error: Error) => void
  ) {
    this._filters = optimizeFilters(filters)
    this.debug = createDebug(`tardis-dev:realtime:${_exchange}`)

    this._wsClientOptions = {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.75 Safari/537.36'
      },
      perMessageDeflate: false,
      handshakeTimeout: 10 * ONE_SEC_IN_MS,
      skipUTF8Validation: true
    } as any
  }

  protected async getWebSocketUrl() {
    const wssUrlOverride = process.env[`WSS_URL_${this._exchange.toUpperCase().replace(/-/g, '_')}`]
    const finalWssUrl = wssUrlOverride !== undefined ? wssUrlOverride : this.wssURL

    return finalWssUrl
  }

  private _close() {
    if (this._closed) {
      return
    }

    this._closed = true
    this._closeController.abort()
    this._closeConnection(this._connection)
  }

  private async *_stream() {
    let retries = 0

    while (this._closed === false) {
      const connectionId = connectionCounter++
      let connection: RealTimeFeedConnection | undefined
      let staleConnectionTimerId: NodeJS.Timeout | undefined
      let pingTimerId: NodeJS.Timeout | undefined
      let connectionError: Error | undefined

      try {
        this.manualSnapshotsBuffer.length = 0
        const subscribeMessages = this.mapToSubscribeMessages(this._filters)
        const finalWssUrl = await resolveOrAbort(this.getWebSocketUrl(), this._closeController.signal)

        if (finalWssUrl === ABORTED || this._closed) {
          return
        }

        this.debug('(connection id: %d) estabilishing connection to %s', connectionId, finalWssUrl)

        this.debug(
          '(connection id: %d) provided filters: %o mapped to subscribe messages: %j',
          connectionId,
          this._filters,
          subscribeMessages
        )

        if (this.originHeader !== undefined) {
          ;(this._wsClientOptions as any).headers['origin'] = this.originHeader
        }

        if (this.extraHeaders !== undefined) {
          Object.assign((this._wsClientOptions as any).headers, this.extraHeaders)
        }

        this._wsClientOptions.agent = getProxyAgent(finalWssUrl)
        const ws = new WebSocket(finalWssUrl, this._wsClientOptions)
        const currentConnection: RealTimeFeedConnection = {
          id: connectionId,
          ws,
          controller: new AbortController(),
          receivedMessagesCount: 0
        }
        connection = currentConnection
        this._connection = currentConnection
        ws.onopen = () => this._onConnectionOpen(currentConnection, subscribeMessages)
        ws.onclose = (event) => this._onConnectionClosed(currentConnection, event)

        staleConnectionTimerId = this._monitorConnectionIfStale(currentConnection)
        pingTimerId = this._sendPeriodicPing(currentConnection)

        const realtimeMessagesStream = createWebSocketStream(ws, {
          readableObjectMode: true, // othwerwise we may end up with multiple messages returned by stream in single iteration
          readableHighWaterMark: 8096 // since we're in object mode, let's increase hwm a little from default of 16 messages buffered
        }) as unknown as AsyncIterableIterator<Buffer>

        for await (let message of realtimeMessagesStream) {
          if (this._isConnectionActive(currentConnection) === false) {
            return
          }

          if (this.decompress !== undefined) {
            message = this.decompress(message)
          }

          // hack to handle huobi long numeric id for trades
          if (this._exchange.startsWith('huobi-') && message.includes('.trade.detail')) {
            message = message.toString().replace(/"id":([0-9]+),/g, '"id":"$1",') as any
          }

          const messageDeserialized = this.parseMessage(message)

          if (this.messageIsError(messageDeserialized)) {
            if (this.isIgnoredError(messageDeserialized)) {
              if (this._onError !== undefined) {
                this.debug(`Received ignored error message: ${message.toString()}`)
              }
            } else {
              throw new Error(`Received error message: ${message.toString()}`)
            }
          }

          // exclude heaartbeat messages from  received messages counter
          // connection could still be stale even if only heartbeats are provided without any data
          if (this.messageIsHeartbeat(messageDeserialized) === false) {
            currentConnection.receivedMessagesCount++
          }

          this.onMessage(messageDeserialized)

          yield messageDeserialized

          if (retries > 0) {
            // reset retries counter as we've received correct message from the connection
            retries = 0
          }

          if (this.manualSnapshotsBuffer.length > 0) {
            for (let snapshot of this.manualSnapshotsBuffer) {
              yield snapshot
            }

            this.manualSnapshotsBuffer.length = 0
          }
        }

        if (this._closed) {
          return
        }
      } catch (error) {
        if (this._closed) {
          return
        }
        connectionError = error instanceof Error ? error : new Error(String(error))
      } finally {
        if (staleConnectionTimerId !== undefined) {
          clearInterval(staleConnectionTimerId)
        }

        if (pingTimerId !== undefined) {
          clearInterval(pingTimerId)
        }

        this._closeConnection(connection)
      }

      if (this._closed) {
        return
      }

      let retryDelay: number | undefined
      if (connectionError !== undefined) {
        this._onError?.(connectionError)
        retries++

        const MAX_DELAY = 32 * 1000
        const isRateLimited = connectionError.message.includes('429')
        retryDelay = isRateLimited ? (MAX_DELAY / 2) * retries : Math.min(Math.pow(2, retries - 1) * 1000, MAX_DELAY)

        this.debug(
          '(connection id: %d) %s real-time feed connection error, retries count: %d, next retry delay: %dms, rate limited: %s error message: %o',
          connectionId,
          this._exchange,
          retries,
          retryDelay,
          isRateLimited,
          connectionError
        )
      }

      yield { __disconnect__: true }

      if (retryDelay !== undefined) {
        await this._wait(retryDelay, this._closeController.signal)
      }
    }
  }

  protected send(msg: any) {
    const ws = this._connection?.ws
    if (ws === undefined || ws.readyState !== WebSocket.OPEN) {
      return
    }
    ws.send(JSON.stringify(msg))
  }

  protected sendRaw(msg: string | Buffer) {
    const ws = this._connection?.ws
    if (ws === undefined || ws.readyState !== WebSocket.OPEN) {
      return
    }
    ws.send(msg)
  }

  protected abstract mapToSubscribeMessages(filters: Filter<string>[]): any[]

  protected abstract messageIsError(message: any): boolean

  protected parseMessage(message: Buffer<ArrayBufferLike>): any {
    return JSON.parse(message as any)
  }

  protected sendCustomPing: (() => void) | undefined = undefined

  protected isIgnoredError(_message: any) {
    return false
  }

  protected messageIsHeartbeat(_msg: any) {
    return false
  }

  protected async provideManualSnapshots(_filters: Filter<string>[], _shouldCancel: () => boolean) {}

  protected onMessage(_msg: any) {}

  protected async onConnected() {}

  protected decompress?: (msg: any) => Buffer

  private _monitorConnectionIfStale(connection: RealTimeFeedConnection) {
    if (this._timeoutIntervalMS === undefined || this._timeoutIntervalMS === 0) {
      return
    }

    // set up timer that checks against open, but stale connections that do not return any data
    return setInterval(() => {
      if (this._isConnectionActive(connection) === false) {
        return
      }

      if (connection.receivedMessagesCount === 0) {
        this.debug(
          '(connection id: %d) did not received any messages within %d ms timeout, terminating connection...',
          connection.id,
          this._timeoutIntervalMS
        )
        connection.ws.terminate()
      }
      connection.receivedMessagesCount = 0
    }, this._timeoutIntervalMS)
  }

  private _sendPeriodicPing(connection: RealTimeFeedConnection) {
    return setInterval(() => {
      if (this._isConnectionOpen(connection) === false) {
        return
      }

      if (this.sendCustomPing !== undefined) {
        this.sendCustomPing()
      } else {
        connection.ws.ping()
      }
    }, 5 * ONE_SEC_IN_MS)
  }

  private async _onConnectionEstablished(connection: RealTimeFeedConnection, subscribeMessages: any[]) {
    const shouldCancel = () => this._isConnectionOpen(connection) === false

    try {
      const symbolsCount = this._filters.reduce((prev, curr) => {
        if (curr.symbols !== undefined) {
          for (const symbol of curr.symbols) {
            prev.add(symbol)
          }
        }
        return prev
      }, new Set<string>()).size

      await this.onConnected()

      if (shouldCancel()) {
        return
      }

      for (const message of subscribeMessages) {
        if (shouldCancel()) {
          return
        }

        this._send(connection, message)
        if (this.throttleSubscribeMS > 0) {
          await this._wait(this.throttleSubscribeMS, connection.controller.signal)
        }
      }

      this.debug('(connection id: %d) established connection', connection.id)

      //wait before fetching snapshots until we're sure we've got proper connection estabilished (received some messages)
      while (shouldCancel() === false && connection.receivedMessagesCount < symbolsCount * 2) {
        await this._wait(100, connection.controller.signal)
      }

      if (shouldCancel()) {
        return
      }

      // wait a second just in case before starting fetching the snapshots
      await this._wait(1 * ONE_SEC_IN_MS, connection.controller.signal)

      if (shouldCancel()) {
        return
      }

      await this.provideManualSnapshots(this._filters, shouldCancel)
    } catch (e) {
      this.debug('(connection id: %d) providing manual snapshots error: %o', connection.id, e)
      if (this._isConnectionOpen(connection)) {
        connection.ws.emit('error', e)
      }
    }
  }

  private _onConnectionClosed(connection: RealTimeFeedConnection, event: WebSocket.CloseEvent) {
    this.debug('(connection id: %d) connection closed %s', connection.id, event.reason)
  }

  private _onConnectionOpen(connection: RealTimeFeedConnection, subscribeMessages: any[]) {
    if (this._isConnectionActive(connection) === false) {
      return
    }

    void this._onConnectionEstablished(connection, subscribeMessages)
  }

  private _send(connection: RealTimeFeedConnection, message: any) {
    if (this._isConnectionOpen(connection)) {
      connection.ws.send(JSON.stringify(message))
    }
  }

  private _isConnectionActive(connection: RealTimeFeedConnection) {
    return this._closed === false && this._connection === connection && connection.controller.signal.aborted === false
  }

  private _isConnectionOpen(connection: RealTimeFeedConnection) {
    return this._isConnectionActive(connection) && connection.ws.readyState === WebSocket.OPEN
  }

  private _closeConnection(connection: RealTimeFeedConnection | undefined) {
    if (connection === undefined) {
      return
    }

    connection.controller.abort()
    if (connection.ws.readyState !== WebSocket.CLOSED) {
      connection.ws.terminate()
    }

    if (this._connection === connection) {
      this._connection = undefined
      this.manualSnapshotsBuffer.length = 0
    }
  }

  private async _wait(delayMS: number, signal: AbortSignal) {
    try {
      await sleep(delayMS, undefined, { signal })
    } catch (error) {
      if (signal.aborted === false) {
        throw error
      }
    }
  }
}

function resolveOrAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) {
    return Promise.resolve(ABORTED)
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const onAbort = () => settle(() => resolve(ABORTED))
    const settle = (callback: () => void) => {
      if (settled) {
        return
      }

      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }

    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error))
    )
  })
}

export abstract class MultiConnectionRealTimeFeedBase implements RealTimeFeedIterable {
  constructor(
    private readonly _exchange: string,
    private readonly _filters: Filter<string>[],
    private readonly _timeoutIntervalMS: number | undefined,
    private readonly _onError?: (error: Error) => void
  ) {}

  [Symbol.asyncIterator](): ManagedRealTimeIterator<any> {
    const realTimeFeeds = Array.from(this._getRealTimeFeeds(this._exchange, this._filters, this._timeoutIntervalMS, this._onError))
    return mergeRealTime(realTimeFeeds)
  }

  protected abstract _getRealTimeFeeds(
    exchange: string,
    filters: Filter<string>[],
    timeoutIntervalMS?: number,
    onError?: (error: Error) => void
  ): IterableIterator<RealTimeFeedIterable>
}

export abstract class PoolingClientBase implements RealTimeFeedIterable {
  protected readonly debug: DebugLogger
  private _tid: NodeJS.Timeout | undefined = undefined
  private _outputStream: PassThrough | undefined

  constructor(
    exchange: string,
    private readonly _poolingIntervalSeconds: number,
    protected readonly onError?: (error: Error) => void
  ) {
    this.debug = createDebug(`tardis-dev:pooling-client:${exchange}`)
  }

  [Symbol.asyncIterator](): ManagedRealTimeIterator<any> {
    return createManagedRealTimeIterator(this._stream(), () => this._close())
  }

  protected abstract poolDataToStream(outputStream: Writable): Promise<void>

  protected getPoolingDelayMS() {
    return this._poolingIntervalSeconds * ONE_SEC_IN_MS
  }

  private _close() {
    if (this._tid !== undefined) {
      clearTimeout(this._tid)
      this._tid = undefined
    }
    this._outputStream?.destroy()
  }

  private async _startPooling(outputStream: Writable) {
    const pool = async () => {
      try {
        await this.poolDataToStream(outputStream)
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))

        this.debug('pooling error %o', error)

        if (this.onError !== undefined) {
          this.onError(error)
        }
      }
    }

    const poolAndSchedule = () => {
      pool().then(() => {
        if (!outputStream.destroyed) {
          this._tid = setTimeout(poolAndSchedule, this.getPoolingDelayMS())
        }
      })
    }
    poolAndSchedule()
  }

  private async *_stream() {
    const stream = new PassThrough({
      objectMode: true,
      highWaterMark: 1024
    })
    this._outputStream = stream

    this._startPooling(stream)

    this.debug('pooling started')

    try {
      for await (const message of stream) {
        yield message
      }
    } finally {
      this._close()
      if (this._outputStream === stream) {
        this._outputStream = undefined
      }

      this.debug('pooling finished')
    }
  }
}
