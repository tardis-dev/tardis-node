import { DUMMY_EXCHANGE_HOST } from '../dummy'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class DummyRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'ws://' + DUMMY_EXCHANGE_HOST + '/ws'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters.map((filter) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('DummyRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return {
        event: 'subscribe',
        symbols: filter.symbols,
        channel: filter.channel
      }
    })
  }

  protected messageIsError(message: any): boolean {
    return message.errorMessage !== undefined
  }

  protected messageIsHeartbeat(message: any): boolean {
    return message.event === 'heartbeat'
  }
}
