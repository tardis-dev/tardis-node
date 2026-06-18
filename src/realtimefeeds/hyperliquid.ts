import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class HyperliquidRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://api.hyperliquid.xyz/ws'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('HyperliquidRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          const isFastBook = filter.channel === 'fastBook'

          return {
            method: 'subscribe',
            subscription: {
              coin: symbol,
              type: isFastBook ? 'l2Book' : filter.channel,
              fast: isFastBook ? true : undefined
            }
          }
        })
      })
      .flatMap((f) => f)
  }

  protected messageIsError(message: any): boolean {
    return message.channel === 'error'
  }

  protected messageIsHeartbeat(message: any): boolean {
    return message.channel === 'pong'
  }

  protected sendCustomPing = () => {
    this.send({ method: 'ping' })
  }
}
