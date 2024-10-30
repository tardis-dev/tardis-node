import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class DydxV4RealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://indexer.dydx.trade/v4/ws'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const subs = filters
      .map((filter) => {
        if (filter.channel === 'v4_markets') {
          return [
            {
              type: 'subscribe',
              channel: 'v4_markets'
            }
          ]
        }

        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('DydxV4RealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          return {
            type: 'subscribe',
            channel: filter.channel,
            id: symbol
          }
        })
      })
      .flatMap((f) => f)

    return subs
  }

  protected messageIsError(message: any): boolean {
    return message.type === 'error'
  }
}
