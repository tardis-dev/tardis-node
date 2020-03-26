import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class BybitRealTimeDataFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://stream.bybit.com/realtime'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const args = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BybitRealTimeDataFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          const suffix = filter.channel === 'instrument_info' || filter.channel === 'orderBook_200' ? '.100ms' : ''
          return `${filter.channel}${suffix}.${symbol}`
        })
      })
      .flatMap((f) => f)

    return [
      {
        op: 'subscribe',
        args
      }
    ]
  }

  protected messageIsError(message: any): boolean {
    return message.success === false
  }
}
