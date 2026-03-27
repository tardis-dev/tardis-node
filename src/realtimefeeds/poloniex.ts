import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class PoloniexRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://ws.poloniex.com/ws/public'

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    return filters.flatMap((filter) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('PoloniexRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return {
        event: 'subscribe',
        channel: [filter.channel],
        symbols: filter.symbols
      }
    })
  }

  protected sendCustomPing = () => {
    this.send({
      event: 'ping'
    })
  }

  protected messageIsHeartbeat(msg: any) {
    return msg.event === 'pong'
  }

  protected messageIsError(message: any): boolean {
    return message.event === 'error'
  }
}
