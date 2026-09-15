import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

abstract class RealTimeFeed extends RealTimeFeedBase {
  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters.flatMap((filter) => {
      if (filter.channel === 'market_stats') {
        return [{ type: 'subscribe', channel: 'market_stats/all' }]
      }

      if (filter.channel === 'spot_market_stats') {
        return [{ type: 'subscribe', channel: 'spot_market_stats/all' }]
      }

      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error(`${this._exchange} RealTimeFeed requires explicitly specified symbols when subscribing to live feed`)
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

export class LighterRealTimeFeed extends RealTimeFeed {
  protected wssURL = 'wss://mainnet.zklighter.elliot.ai/stream'
}

export class LighterRhRealTimeFeed extends RealTimeFeed {
  protected wssURL = 'wss://api.rh.lighter.xyz/stream'
}
