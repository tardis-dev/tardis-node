import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class LighterRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://mainnet.zklighter.elliot.ai/stream'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters.flatMap((filter) => {
      if (filter.channel === 'market_stats') {
        return [{ type: 'subscribe', channel: 'market_stats/all' }]
      }

      if (filter.channel === 'spot_market_stats') {
        return [{ type: 'subscribe', channel: 'spot_market_stats/all' }]
      }

      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('LighterRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return filter.symbols.map((marketId) => ({
        type: 'subscribe',
        channel: `${filter.channel}/${marketId}`
      }))
    })
  }

  protected messageIsError(message: any): boolean {
    return message.error !== undefined
  }
}
