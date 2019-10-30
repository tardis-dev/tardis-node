import { Filter, FilterForExchange } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class DeribitRealTimeDataFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://www.deribit.com/ws/api/v2'

  protected channelsWithIntervals: FilterForExchange['deribit']['channel'][] = ['book', 'perpetual', 'trades', 'ticker']

  protected mapToSubscribeMessages(filters: Filter<string>[]): string | any[] {
    const channels = filters
      .map(filter => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('DeribitRealTimeDataFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map(symbol => {
          const suffix = this.channelsWithIntervals.includes(filter.channel as any) ? '.raw' : ''
          return `${filter.channel}.${symbol}${suffix}`
        })
      })
      .flatMap(f => f)

    return [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'public/subscribe',
        params: {
          channels
        }
      }
    ]
  }

  protected messageIsError(message: any): boolean {
    return message.error !== undefined
  }
}
