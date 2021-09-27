import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class PoloniexRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://api2.poloniex.com'

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    const allSymbols = filters.flatMap((filter) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('PoloniexRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }
      return filter.symbols
    })

    const uniqueSymbols = [...new Set(allSymbols)]

    return uniqueSymbols.map((symbol) => {
      return {
        command: 'subscribe',
        channel: symbol
      }
    })
  }

  protected messageIsError(message: any): boolean {
    return message.error !== undefined && message.error !== null
  }
}
