import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class CryptofacilitiesRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://api.cryptofacilities.com/ws/v1'

  protected mapToSubscribeMessages(filters: Filter<string>[]): string | any[] {
    return filters
      .filter(filter => filter.channel.endsWith('_snapshot') === false)
      .map(filter => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('CryptofacilitiesRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return {
          event: 'subscribe',
          product_ids: filter.symbols,
          feed: filter.channel
        }
      })
  }

  protected messageIsError(message: any): boolean {
    return message.event === 'error'
  }
}
