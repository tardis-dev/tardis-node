import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class BybitSpotRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://stream.bybit.com/spot/quote/ws/v2'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BybitSpotRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          return {
            event: 'sub',
            topic: filter.channel,
            params: {
              binary: false,
              symbol: symbol
            }
          }
        })
      })
      .flatMap((c) => c)
  }

  protected messageIsError(message: any): boolean {
    return message.code !== undefined && message.code !== '0'
  }

  protected sendCustomPing = () => {
    this.send({ ping: new Date().valueOf() })
  }

  protected messageIsHeartbeat(msg: any) {
    return msg.pong !== undefined
  }
}
