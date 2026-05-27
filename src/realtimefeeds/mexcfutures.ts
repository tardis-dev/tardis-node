import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class MexcFuturesRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://contract.mexc.com/edge'

  protected sendCustomPing = () => {
    this.send({ method: 'ping' })
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters.flatMap((filter) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('MexcFuturesRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return filter.symbols.map((symbol) => ({
        method: filter.channel.replace(/^push\./, 'sub.'),
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
