import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class MexcFuturesRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://contract.mexc.com/edge'
  protected readonly channelToSubscriptionMethod = {
    'push.deal': 'sub.deal',
    'push.depth': 'sub.depth',
    'push.ticker': 'sub.ticker',
    'push.index.price': 'sub.index.price',
    'push.fair.price': 'sub.fair.price',
    'push.funding.rate': 'sub.funding.rate'
  } as const

  protected sendCustomPing = () => {
    this.send({ method: 'ping' })
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters.flatMap((filter) => {
      const method = this.channelToSubscriptionMethod[filter.channel as keyof typeof this.channelToSubscriptionMethod]
      if (method === undefined) {
        throw new Error(`Unsupported MEXC futures channel ${filter.channel}`)
      }

      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('MexcFuturesRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return filter.symbols.map((symbol) => ({
        method,
        param: { symbol },
        gzip: false
      }))
    })
  }

  protected messageIsError(message: any): boolean {
    return message.success === false || message.error !== undefined
  }

  protected messageIsHeartbeat(message: any) {
    return message.channel === 'pong'
  }
}
