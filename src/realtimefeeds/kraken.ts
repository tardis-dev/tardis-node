import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class KrakenRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://ws.kraken.com'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters.map((filter) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('KrakenRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      let depth = undefined

      if (filter.channel === 'book') {
        depth = 1000
      }

      return {
        event: 'subscribe',
        pair: filter.symbols,
        subscription: {
          name: filter.channel,
          depth
        }
      }
    })
  }

  protected messageIsError(message: any): boolean {
    return message.errorMessage !== undefined
  }

  protected messageIsHeartbeat(message: any): boolean {
    return message.event === 'heartbeat'
  }
}
