import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class BinanceOptionsRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://vstream.binance.com/stream'
  protected httpURL = 'https://vapi.binance.com/vapi/v1'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const payload = filters.map((filter, index) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('BinanceOptionsRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return {
        method: 'SUBSCRIBE',
        params: filter.symbols.map((symbol) => `${symbol}@${filter.channel}`),
        id: index + 1
      }
    })

    const noBinary = {
      method: 'BINARY',
      params: ['false'],
      id: 0
    }

    return [noBinary, ...payload]
  }

  protected messageIsError(message: any): boolean {
    if (message.data !== undefined && message.data.e === 'error') {
      return true
    }

    return false
  }
}
