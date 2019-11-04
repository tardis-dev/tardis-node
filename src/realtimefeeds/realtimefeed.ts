import dbg from 'debug'
import WebSocket from 'ws'
import { ONE_SEC_IN_MS, wait } from '../handy'
import { Exchange, Filter } from '../types'

export type RealTimeFeed = {
  stream(filters: Filter<string>[]): AsyncIterableIterator<object | undefined>
  setTimeoutInterval(timeoutIntervalMS: number): void
  readonly exchange: Exchange
}

export abstract class RealTimeFeedBase implements RealTimeFeed {
  private timeoutIntervalMS?: number
  protected readonly debug: dbg.Debugger

  constructor(public readonly exchange: Exchange) {
    this.debug = dbg(`tardis-dev:realtime:${exchange}`)
  }

  public setTimeoutInterval(timeoutIntervalMS: number): void {
    this.timeoutIntervalMS = timeoutIntervalMS
  }

  public async *stream(filters: Filter<string>[]) {
    const subscribeMessages = this.mapToSubscribeMessages(filters)
    this.debug('starting streaming: %o filters, subscribe messages: %o', filters, subscribeMessages)

    let retries = 0

    while (true) {
      let staleConnectionCheckTID: NodeJS.Timeout | undefined
      try {
        const address = typeof subscribeMessages === 'string' ? `${this.wssURL}${subscribeMessages}` : this.wssURL
        this.debug('estabilishing connection to %s', address)

        const ws = new WebSocket(address, { perMessageDeflate: false })

        let snapshotsToReturn: any[] = []
        let receivedMessagesCount = 0

        ws.onopen = this._onConnectionOpen({
          address,
          subscribeMessages,
          snapshotsToReturn,
          filters
        })

        if (this.timeoutIntervalMS !== undefined) {
          // set up timer that checks against open, but stale connections that do not return any data
          staleConnectionCheckTID = setInterval(() => {
            if (receivedMessagesCount === 0) {
              this.debug('did not received any messages within %d ms timeout, restarting...', this.timeoutIntervalMS)
              ws.terminate()
              if (staleConnectionCheckTID !== undefined) {
                clearInterval(staleConnectionCheckTID)
                staleConnectionCheckTID = undefined
              }
            }
            // reset counter which we'll check again after timeout
            receivedMessagesCount = 0
          }, this.timeoutIntervalMS)
        }

        const realtimeMessagesStream = (WebSocket as any).createWebSocketStream(ws, {
          readableObjectMode: true, // othwerwise we may end up with multiple messages returned by stream in single iteration
          readableHighWaterMark: 1024 // since we're in object mode, let's increase hwm a little from default of 16 messages buffered
        }) as AsyncIterableIterator<Buffer>

        for await (let message of realtimeMessagesStream) {
          if (this.decompress !== undefined) {
            message = await this.decompress(message)
            if (message === undefined) {
              continue
            }
          }

          const messageDeserialized = JSON.parse(message as any)

          if (this.messageIsError(messageDeserialized)) {
            throw new Error(`Received error message:${message}`)
          }

          // exclude heaartbeat messages from  received messages counter
          // connection could still be stale even if only heartbeats are provided without any data
          if (this.messageIsHeartbeat(messageDeserialized) === false) {
            receivedMessagesCount++
          }

          this.onMessage(messageDeserialized, ws)

          yield messageDeserialized

          if (retries > 0) {
            // reset retries counter as we've received correct message from the connection
            retries = 0
          }

          if (snapshotsToReturn.length > 0) {
            for (let snapshot of snapshotsToReturn) {
              yield snapshot
            }

            snapshotsToReturn.length = 0
          }
        }

        this.debug('connection closed, restarting...')
        // websocket connection has been closed notify about it by yielding undefined
        yield undefined
      } catch (error) {
        retries++
        this.debug('real-time feed error: %o, retries %d', error, retries)

        yield undefined
        const isRateLimited = error.message.includes('429')
        const expontent = isRateLimited ? retries + 4 : retries
        const delay = Math.pow(2, expontent) * 1000

        await wait(delay)
      } finally {
        if (staleConnectionCheckTID !== undefined) {
          clearInterval(staleConnectionCheckTID)
          staleConnectionCheckTID = undefined
        }
      }
    }
  }

  private _onConnectionOpen({
    address,
    filters,
    snapshotsToReturn,
    subscribeMessages
  }: {
    address: string
    subscribeMessages: string | any[]
    filters: Filter<string>[]
    snapshotsToReturn: any[]
  }) {
    return async ({ target }: WebSocket.OpenEvent) => {
      this.debug('estabilished connection to %s', address)

      if (Array.isArray(subscribeMessages)) {
        for (const message of subscribeMessages) {
          this.debug('subscribing to %o', message)
          target.send(JSON.stringify(message))
        }
      }

      this.onConnected(target)

      try {
        await wait(ONE_SEC_IN_MS)
        await this.provideManualSnapshots(filters, snapshotsToReturn, () => target.readyState === WebSocket.CLOSED)
      } catch (e) {
        this.debug('providing manual snapshots error: %o, closing connection...', e)
      }
    }
  }

  protected abstract readonly wssURL: string
  protected abstract mapToSubscribeMessages(filters: Filter<string>[]): string | any[]
  protected abstract messageIsError(message: any): boolean

  protected messageIsHeartbeat(_msg: any) {
    return false
  }

  protected async provideManualSnapshots(_filters: Filter<string>[], _snapshotsBuffer: any[], _shouldCancel: () => boolean) {}

  protected onMessage(_msg: any, _ws: WebSocket) {}

  protected onConnected(_ws: WebSocket) {}

  protected decompress?: (msg: any) => Promise<any>
}
