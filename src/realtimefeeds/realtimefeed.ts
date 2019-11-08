import dbg from 'debug'
import WebSocket from 'ws'
import { ONE_SEC_IN_MS, wait } from '../handy'
import { Exchange, Filter } from '../types'

export type RealTimeFeed = {
  new (exchange: Exchange, filters: Filter<string>[], timeoutIntervalMS: number | undefined): RealTimeFeedIterable
}

export type RealTimeFeedIterable = AsyncIterable<any>

export abstract class RealTimeFeedBase implements RealTimeFeedIterable {
  [Symbol.asyncIterator]() {
    return this._stream()
  }

  private timeoutIntervalMS?: number
  protected readonly debug: dbg.Debugger
  protected abstract readonly wssURL: string
  protected readonly manualSnapshotsBuffer: any[] = []
  private _receivedMessagesCount = 0
  private _staleConnectionCheckIntervalId?: NodeJS.Timeout
  private _ws?: WebSocket

  constructor(
    public readonly exchange: string,
    private readonly _filters: Filter<string>[],
    private readonly _timeoutIntervalMS: number | undefined
  ) {
    this.debug = dbg(`tardis-dev:realtime:${exchange}`)
  }

  private async *_stream() {
    try {
      const subscribeMessages = this.mapToSubscribeMessages(this._filters)
      const address = typeof subscribeMessages === 'string' ? `${this.wssURL}${subscribeMessages}` : this.wssURL
      if ((typeof subscribeMessages === 'string') === false) {
        this.debug('mapped filters: %o to subscribe messages: %o', this._filters, subscribeMessages)
      }

      this.debug('estabilishing connection to %s')

      this._ws = new WebSocket(address, { perMessageDeflate: false })

      this._ws.onopen = this._onConnectionEstabilished

      const realtimeMessagesStream = (WebSocket as any).createWebSocketStream(this._ws, {
        readableObjectMode: true, // othwerwise we may end up with multiple messages returned by stream in single iteration
        readableHighWaterMark: 1024 // since we're in object mode, let's increase hwm a little from default of 16 messages buffered
      }) as AsyncIterableIterator<Buffer>

      for await (let message of realtimeMessagesStream) {
        if (this.decompress !== undefined) {
          message = this.decompress(message)
          if (message === undefined) {
            continue
          }
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

        if (this.manualSnapshotsBuffer.length > 0) {
          for (let snapshot of this.manualSnapshotsBuffer) {
            yield snapshot
          }

          this.manualSnapshotsBuffer.length = 0
        }
      }

      this.debug('connection closed')
    } finally {
      if (this._staleConnectionCheckIntervalId !== undefined) {
        clearInterval(this._staleConnectionCheckIntervalId)
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

  protected abstract mapToSubscribeMessages(filters: Filter<string>[]): string | any[]

  protected abstract messageIsError(message: any): boolean

  protected messageIsHeartbeat(_msg: any) {
    return false
  }

  protected async provideManualSnapshots(_filters: Filter<string>[], _shouldCancel: () => boolean) {}

  protected onMessage(_msg: any) {}

  protected onConnected() {}

  protected decompress?: (msg: any) => any

  private _monitorConnectionIfStale() {
    if (this._timeoutIntervalMS === undefined || this._timeoutIntervalMS === 0) {
      return
    }

    // set up timer that checks against open, but stale connections that do not return any data
    this._staleConnectionCheckIntervalId = setInterval(() => {
      if (this._ws === undefined) {
        return
      }

      if (this._receivedMessagesCount === 0) {
        this.debug('did not received any messages within %d ms timeout, terminating connection...', this.timeoutIntervalMS)
        this._ws!.terminate()
      }
    }, this._timeoutIntervalMS)
  }

  private _onConnectionEstabilished = async () => {
    try {
      this._monitorConnectionIfStale()

      const subscribeMessages = this.mapToSubscribeMessages(this._filters)

      let symbolsCount = this._filters.reduce((prev, curr) => {
        if (curr.symbols !== undefined) {
          for (const symbol of curr.symbols) {
            prev.add(symbol)
          }
        }
        return prev
      }, new Set<string>()).size

      if (Array.isArray(subscribeMessages)) {
        for (const message of subscribeMessages) {
          this.send(message)
        }
      }

      this.debug('estabilished connection')

      this.onConnected()

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
      this.debug('providing manual snapshots error: %o, closing connection...', e)
      this._ws!.terminate()
    }
  }
}
