import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class DydxRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://api.dydx.exchange/v3/ws'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const subs = filters
      .map((filter) => {
        if (filter.channel === 'v3_markets') {
          return [
            {
              type: 'subscribe',
              channel: 'v3_markets'
            }
          ]
        }

        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('DydxRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          return {
            type: 'subscribe',
            channel: filter.channel,
            id: symbol,
            includeOffsets: filter.channel === 'v3_orderbook' ? true : undefined
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
