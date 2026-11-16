import { Filter } from '../types.ts'
import type { PoloniexV2BookMessage } from '../mappers/poloniex.ts'
import { RealTimeFeedBase, Sequence } from './realtimefeed.ts'

export class PoloniexRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://ws.poloniex.com/ws/public'

  protected getSequence({ channel, action, data }: PoloniexV2BookMessage): Sequence | undefined {
    if (channel === 'book_lv2' && (action === 'snapshot' || action === 'update')) {
      return {
        key: data[0].symbol,
        sequence: data[0].id,
        previousSequence: action === 'snapshot' ? undefined : data[0].lastId
      }
    }
    return undefined
  }

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
