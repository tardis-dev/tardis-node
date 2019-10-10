import WebSocket from 'ws'
import dbg from 'debug'
import zlib from 'zlib'
import { promisify } from 'util'
import { Filter } from '../types'
import { wait, ONE_SEC_IN_MS } from '../handy'
const inflateRaw = promisify(zlib.inflateRaw)

const debug = dbg('tardis-client')
const pongBuffer = Buffer.from('pong')

export type RealTimeFeed = {
  stream(filters: Filter<string>[]): AsyncIterableIterator<object | undefined>
  setTimeoutInterval(timeoutIntervalMS: number): void
}

export abstract class RealTimeFeedBase implements RealTimeFeed {
  private timeoutIntervalMS?: number
  public setTimeoutInterval(timeoutIntervalMS: number): void {
    this.timeoutIntervalMS = timeoutIntervalMS
  }

  public async *stream(filters: Filter<string>[]) {
    const subscribeMessages = this.mapToSubscribeMessages(filters)
    debug('mapped filters: %o to subscribe messages: %o', filters, subscribeMessages)

    const subscribeViaURL = typeof subscribeMessages === 'string'
    let retries = 0

    while (true) {
      let timerid: NodeJS.Timeout | undefined
      try {
        const address = subscribeViaURL ? `${this.wssURL}${subscribeMessages}` : this.wssURL
        debug('estabilishing connection to %s', address)

        const ws = new WebSocket(address)

        let snapshotsToReturn: any[] = []
        let receivedMessagesCount = 0
        ws.once('open', async () => {
          debug('estabilished connection to %s', address)
          if (!subscribeViaURL) {
            for (const message of subscribeMessages) {
              debug('subscribing to %o', message)
              ws.send(JSON.stringify(message))
            }
          }

          if (this.provideManualSnapshots !== undefined) {
            await wait(ONE_SEC_IN_MS)
            this.provideManualSnapshots(filters, snapshotsToReturn, () => ws.readyState === WebSocket.CLOSED)
          }
        })

        if (this.timeoutIntervalMS !== undefined) {
          // set up timer that checks against open, but stale connections that do not return any data
          timerid = setInterval(() => {
            if (receivedMessagesCount === 0) {
              debug('did not received any messages within %d ms timeout, restarting...', this.timeoutIntervalMS)
              ws.terminate()
              if (timerid !== undefined) {
                clearInterval(timerid)
                timerid = undefined
              }
            }
            // reset counter which we'll check again after timeout
            receivedMessagesCount = 0
          }, this.timeoutIntervalMS)
        }

        const realtimeMessagesStream = (WebSocket as any).createWebSocketStream(ws) as AsyncIterableIterator<Buffer>

        for await (let message of realtimeMessagesStream) {
          receivedMessagesCount++

          if (this.messagesNeedDecompression) {
            message = (await inflateRaw(message)) as Buffer
            if (message.equals(pongBuffer)) {
              continue
            }
          }

          const messageDeserialized = JSON.parse(message as any)

          if (this.messageIsError(messageDeserialized)) {
            throw new Error(`Received error message:${message}`)
          }

          if (this.onMessage !== undefined) {
            this.onMessage(messageDeserialized, ws)
          }

          yield messageDeserialized

          if (retries > 0) {
            // reset retries counter as we've received correct message from the connection
            retries = 0
          }

          if (snapshotsToReturn.length > 0) {
            for (let snapshot of snapshotsToReturn) {
              yield snapshot
            }
            snapshotsToReturn = []
          }
        }

        // websocket connection has been closed notify about it by yielding undefined
        yield undefined
      } catch (error) {
        retries++
        debug('real-time feed error: %o, retries %d', error, retries)

        yield undefined
        const isRateLimited = error.message.includes('429')
        const expontent = isRateLimited ? retries + 4 : retries
        const delay = Math.pow(2, expontent) * 1000

        await wait(delay)
      } finally {
        if (timerid !== undefined) {
          clearInterval(timerid)
          timerid = undefined
        }
      }
    }
  }

  protected abstract readonly wssURL: string
  protected abstract mapToSubscribeMessages(filters: Filter<string>[]): string | any[]
  protected abstract messageIsError(message: any): boolean

  protected provideManualSnapshots?: (filters: Filter<string>[], snapshotsBuffer: any[], shouldCancel: () => boolean) => void
  protected onMessage?: (msg: any, ws: WebSocket) => void
  protected messagesNeedDecompression = false
}
