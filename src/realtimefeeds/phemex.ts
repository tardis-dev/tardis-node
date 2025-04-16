import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class PhemexRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://ws.phemex.com/'
  protected readonly throttleSubscribeMS = 100

  protected readonly channelsMap = {
    book: 'orderbook.subscribe',
    orderbook_p: 'orderbook_p.subscribe',
    trades: 'trade.subscribe',
    trades_p: 'trade_p.subscribe',
    market24h: 'market24h.subscribe',
    spot_market24h: 'spot_market24h.subscribe',
    perp_market24h_pack_p: 'perp_market24h_pack_p.subscribe'
  } as any

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    let id = 0
    return filters

      .map((filter) => {
        if (
          filter.symbols !== undefined &&
          filter.channel !== 'market24h' &&
          filter.channel !== 'spot_market24h' &&
          filter.channel !== 'perp_market24h_pack_p'
        ) {
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
