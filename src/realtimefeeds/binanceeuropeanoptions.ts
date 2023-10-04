import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class BinanceEuropeanOptionsRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://nbstream.binance.com/eoptions/stream'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const payload = filters.map((filter, index) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('BinanceEuropeanOptionsRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return {
        method: 'SUBSCRIBE',
        params: filter.symbols.map((symbol) => {
          if (filter.channel === 'depth100') {
            return `${symbol}@${filter.channel}@100ms`
          }

          return `${symbol}@${filter.channel}`
        }),
        id: index + 1
      }
    })

    return payload
  }

  protected messageIsError(message: any): boolean {
    if (message.data !== undefined && message.data.e === 'error') {
      return true
    }

    return false
  }
}
