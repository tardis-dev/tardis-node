import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class CoinflexRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://v2api.coinflex.com/v2/websocket'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const payload = filters.map((filter) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('CoinflexRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return {
        op: 'subscribe',
        args: filter.symbols.map((s) => `${filter.channel}:${s}`)
      }
    })

    return payload
  }

  protected messageIsError(message: any): boolean {
    return message.success === false
  }
}
