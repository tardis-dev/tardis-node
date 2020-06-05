import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class PhemexRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://phemex.com/ws'
  protected readonly channelsMap = {
    book: 'orderbook.subscribe',
    trades: 'trade.subscribe',
    market24h: 'market24h.subscribe'
  } as any

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    let id = 0
    return filters
      .map((filter) => {
        if (filter.symbols !== undefined && filter.channel !== 'market24h') {
          return filter.symbols.map((symbol) => {
            return {
              id: id++,
              method: this.channelsMap[filter.channel],
              params: [symbol]
            }
          })
        } else {
          return [
            {
              id: id++,
              method: this.channelsMap[filter.channel],
              params: []
            }
          ]
        }
      })
      .flatMap((f) => f)
  }

  protected messageIsError(message: any): boolean {
    return message.error !== undefined && message.error !== null
  }
}
