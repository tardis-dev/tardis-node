import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'
const TIMESTAMP = 32768
const SEQ_ALL = 65536

export class BitfinexRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://api-pub.bitfinex.com/ws/2'

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    const configMessage = {
      event: 'conf',
      flags: TIMESTAMP | SEQ_ALL
    }

    const subscribeMessages = filters
      .map((filter) => {
        if (filter.channel !== 'liquidations' && (!filter.symbols || filter.symbols.length === 0)) {
          throw new Error('BitfinexRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }
        if (filter.channel === 'liquidations') {
          return [
            {
              event: 'subscribe',
              channel: 'status',
              key: 'liq:global'
            }
          ]
        }

        return filter.symbols!.map((symbol) => {
          if (filter.channel === 'trades') {
            return {
              event: 'subscribe',
              channel: 'trades',
              symbol: `t${symbol}`
            }
          }
          if (filter.channel === 'book') {
            return {
              event: 'subscribe',
              channel: 'book',
              len: 100,
              prec: 'P0',
              freq: 'F0',
              symbol: `t${symbol}`
            }
          }

          if (filter.channel === 'status') {
            return {
              event: 'subscribe',
              channel: 'status',
              key: `deriv:t${symbol}`
            }
          }

          if (filter.channel === 'raw_book') {
            return {
              event: 'subscribe',
              channel: 'book',
              len: 100,
              prec: 'R0',
              freq: 'F0',
              symbol: `t${symbol}`
            }
          }

          return
        })
      })
      .flatMap((c) => c)

    return [configMessage, ...subscribeMessages]
  }

  protected messageIsError(message: any) {
    return message.event === 'error'
  }

  protected messageIsHeartbeat(message: any) {
    return Array.isArray(message) && message.length > 1 && message[1] === 'hb'
  }
}
