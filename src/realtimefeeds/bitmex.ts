import { batch } from '../handy.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class BitmexRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://ws.bitmex.com/realtime'

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    return filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          return [
            {
              op: 'subscribe',
              args: [filter.channel]
            }
          ]
        }
        const subscribeMessages = []
        for (const symbolsBatch of batch(filter.symbols, 10)) {
          subscribeMessages.push({
            op: 'subscribe',
            args: symbolsBatch.map((s) => `${filter.channel}:${s}`)
          })
        }

        return subscribeMessages
      })
      .flatMap((s) => s)
  }

  protected messageIsError(message: any): boolean {
    if (message.error !== undefined) {
      return true
    }

    if ('subscribe' in message && message.success === false) {
      return true
    }
    return false
  }
}
