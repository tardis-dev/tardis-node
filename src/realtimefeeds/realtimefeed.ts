import dbg from 'debug'
import WebSocket from 'ws'
import { ClientRequestArgs } from 'http'
import { PassThrough, Writable } from 'stream'
import { once } from 'events'
import { httpsProxyAgent, ONE_SEC_IN_MS, optimizeFilters, wait } from '../handy'
import { Exchange, Filter } from '../types'

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

export abstract class RealTimeFeedBase implements RealTimeFeedIterable {
  [Symbol.asyncIterator]() {
    return this._stream()
  }

  protected readonly debug: dbg.Debugger
  protected abstract readonly wssURL: string
  protected readonly throttleSubscribeMS: number = 0
  protected readonly manualSnapshotsBuffer: any[] = []
  private readonly _filters: Filter<string>[]
  private _receivedMessagesCount = 0
  private _ws?: WebSocket
  private _connectionId = connectionCounter++
  private _wsClientOptions: WebSocket.ClientOptions | ClientRequestArgs

  constructor(
    protected readonly _exchange: string,
    filters: Filter<string>[],
    private readonly _timeoutIntervalMS: number | undefined,
    private readonly _onError?: (error: Error) => void
  ) {
    this._filters = optimizeFilters(filters)
    this.debug = dbg(`tardis-dev:realtime:${_exchange}`)

    this._wsClientOptions = { perMessageDeflate: false, handshakeTimeout: 10 * ONE_SEC_IN_MS, skipUTF8Validation: true } as any

    if (httpsProxyAgent !== undefined) {
      this._wsClientOptions.agent = httpsProxyAgent
    }
  }

  private async *_stream() {
    let staleConnectionTimerId
    let pingTimerId
    let retries = 0

    while (true) {
      try {
        const subscribeMessages = this.mapToSubscribeMessages(this._filters)

        const wssUrlOverride = process.env[`WSS_URL_${this._exchange.toUpperCase()}`]
        const finalWssUrl = wssUrlOverride !== undefined ? wssUrlOverride : this.wssURL

        this.debug('(connection id: %d) estabilishing connection to %s', this._connectionId, finalWssUrl)

        this.debug(
          '(connection id: %d) provided filters: %o mapped to subscribe messages: %o',
          this._connectionId,
          this._filters,
          subscribeMessages
        )

        this._ws = new WebSocket(finalWssUrl, this._wsClientOptions)
        this._ws.onopen = this._onConnectionEstabilished
        this._ws.onclose = this._onConnectionClosed

        staleConnectionTimerId = this._monitorConnectionIfStale()
        pingTimerId = this._sendPeriodicPing()

        const realtimeMessagesStream = (WebSocket as any).createWebSocketStream(this._ws, {
          readableObjectMode: true, // othwerwise we may end up with multiple messages returned by stream in single iteration
          readableHighWaterMark: 8096 // since we're in object mode, let's increase hwm a little from default of 16 messages buffered
        }) as AsyncIterableIterator<Buffer>

        for await (let message of realtimeMessagesStream) {
          if (this.decompress !== undefined) {
            message = this.decompress(message)
          }

          const messageDeserialized = JSON.parse(message as any)

          if (this.messageIsError(messageDeserialized)) {
            throw new Error(`Received error message:${message.toString()}`)
          }

          // exclude heaartbeat messages from  received messages counter
          // connection could still be stale even if only heartbeats are provided without any data
          if (this.messageIsHeartbeat(messageDeserialized) === false) {
            this._receivedMessagesCount++
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

        // clear monitoring connection timer and notify about disconnect
        if (staleConnectionTimerId !== undefined) {
          clearInterval(staleConnectionTimerId)
        }
        yield { __disconnect__: true }
      } catch (error: any) {
        if (this._onError !== undefined) {
          this._onError(error)
        }

        retries++

        const MAX_DELAY = 32 * 1000
        const isRateLimited = error.message.includes('429')

        let delay
        if (isRateLimited) {
          delay = (MAX_DELAY / 2) * retries
        } else {
          delay = Math.pow(2, retries - 1) * 1000

          if (delay > MAX_DELAY) {
            delay = MAX_DELAY
          }
        }

        this.debug(
          '(connection id: %d) %s real-time feed connection error, retries count: %d, next retry delay: %dms, rate limited: %s error message: %o',
          this._connectionId,
          this._exchange,
          retries,
          delay,
          isRateLimited,
          error
        )

        // clear monitoring connection timer and notify about disconnect
        if (staleConnectionTimerId !== undefined) {
          clearInterval(staleConnectionTimerId)
        }
        yield { __disconnect__: true }

        await wait(delay)
      } finally {
        // stop timers
        if (staleConnectionTimerId !== undefined) {
          clearInterval(staleConnectionTimerId)
        }

        if (pingTimerId !== undefined) {
          clearInterval(pingTimerId)
        }
      }
    }
  }

  protected send(msg: any) {
    if (this._ws === undefined) {
      return
    }
    if (this._ws.readyState !== WebSocket.OPEN) {
      return
    }
    this._ws.send(JSON.stringify(msg))
  }

  protected abstract mapToSubscribeMessages(filters: Filter<string>[]): any[]

  protected abstract messageIsError(message: any): boolean

  protected messageIsHeartbeat(_msg: any) {
    return false
  }

  protected async provideManualSnapshots(_filters: Filter<string>[], _shouldCancel: () => boolean) {}

  protected onMessage(_msg: any) {}

  protected onConnected() {}

  protected decompress?: (msg: any) => Buffer

  private _monitorConnectionIfStale() {
    if (this._timeoutIntervalMS === undefined || this._timeoutIntervalMS === 0) {
      return
    }

    // set up timer that checks against open, but stale connections that do not return any data
    return setInterval(() => {
      if (this._ws === undefined) {
        return
      }

      if (this._receivedMessagesCount === 0) {
        this.debug(
          '(connection id: %d) did not received any messages within %d ms timeout, terminating connection...',
          this._connectionId,
          this._timeoutIntervalMS
        )
        this._ws!.terminate()
      }
      this._receivedMessagesCount = 0
    }, this._timeoutIntervalMS)
  }

  private _sendPeriodicPing() {
    return setInterval(() => {
      if (this._ws === undefined || this._ws.readyState !== WebSocket.OPEN) {
        return
      }

      this._ws.ping()
    }, 5 * ONE_SEC_IN_MS)
  }

  private _onConnectionEstabilished = async () => {
    try {
      const subscribeMessages = this.mapToSubscribeMessages(this._filters)

      let symbolsCount = this._filters.reduce((prev, curr) => {
        if (curr.symbols !== undefined) {
          for (const symbol of curr.symbols) {
            prev.add(symbol)
          }
        }
        return prev
      }, new Set<string>()).size

      this.onConnected()

      for (const message of subscribeMessages) {
        this.send(message)
        if (this.throttleSubscribeMS > 0) {
          await wait(this.throttleSubscribeMS)
        }
      }

      this.debug('(connection id: %d) estabilished connection', this._connectionId)

      //wait before fetching snapshots until we're sure we've got proper connection estabilished (received some messages)
      while (this._receivedMessagesCount < symbolsCount * 2) {
        await wait(100)
      }
      // wait a second just in case before starting fetching the snapshots
      await wait(1 * ONE_SEC_IN_MS)

      if (this._ws!.readyState === WebSocket.CLOSED) {
        return
      }

      await this.provideManualSnapshots(this._filters, () => this._ws!.readyState === WebSocket.CLOSED)
    } catch (e) {
      this.debug('(connection id: %d) providing manual snapshots error: %o', this._connectionId, e)
      this._ws!.emit('error', e)
    }
  }

  private _onConnectionClosed = (event: WebSocket.CloseEvent) => {
    this.debug('(connection id: %d) connection closed %s', this._connectionId, event.reason)
  }
}

export abstract class MultiConnectionRealTimeFeedBase implements RealTimeFeedIterable {
  constructor(
    private readonly _exchange: string,
    private readonly _filters: Filter<string>[],
    private readonly _timeoutIntervalMS: number | undefined,
    private readonly _onError?: (error: Error) => void
  ) {}

  [Symbol.asyncIterator]() {
    return this._stream()
  }

  private async *_stream() {
    const combinedStream = new PassThrough({
      objectMode: true,
      highWaterMark: 8096
    })

    const realTimeFeeds = this._getRealTimeFeeds(this._exchange, this._filters, this._timeoutIntervalMS, this._onError)

    for (const realTimeFeed of realTimeFeeds) {
      // iterate over separate real-time feeds and write their messages into combined stream
      ;(async function writeMessagesToCombinedStream() {
        for await (const message of realTimeFeed) {
          if (combinedStream.destroyed) {
            return
          }

          if (!combinedStream.write(message))
            // Handle backpressure on write
            await once(combinedStream, 'drain')
        }
      })()
    }

    for await (const message of combinedStream) {
      yield message
    }
  }

  protected abstract _getRealTimeFeeds(
    exchange: string,
    filters: Filter<string>[],
    timeoutIntervalMS?: number,
    onError?: (error: Error) => void
  ): IterableIterator<RealTimeFeedIterable>
}

export abstract class PoolingClientBase implements RealTimeFeedIterable {
  protected readonly debug: dbg.Debugger
  private _tid: NodeJS.Timeout | undefined = undefined
  constructor(exchange: string, private readonly _poolingIntervalSeconds: number) {
    this.debug = dbg(`tardis-dev:pooling-client:${exchange}`)
  }

  [Symbol.asyncIterator]() {
    return this._stream()
  }

  protected abstract poolDataToStream(outputStream: Writable): Promise<void>

  private async _startPooling(outputStream: Writable) {
    const timeoutInterval = this._poolingIntervalSeconds * ONE_SEC_IN_MS

    const pool = async () => {
      try {
        await this.poolDataToStream(outputStream)
      } catch (e) {
        this.debug('pooling error %o', e)
      }
    }

    const poolAndSchedule = () => {
      pool().then(() => {
        if (!outputStream.destroyed) {
          this._tid = setTimeout(poolAndSchedule, timeoutInterval)
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

    this._startPooling(stream)

    this.debug('pooling started')

    try {
      for await (const message of stream) {
        yield message
      }
    } finally {
      if (this._tid !== undefined) {
        clearInterval(this._tid)
      }

      this.debug('pooling finished')
    }
  }
}
