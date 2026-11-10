import { Filter } from '../types.ts'
import type { PoloniexV2BookMessage } from '../mappers/poloniex.ts'
import { RealTimeFeedBase, SequenceInfo } from './realtimefeed.ts'

export class PoloniexRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://ws.poloniex.com/ws/public'

  protected getSequence({ channel, action, data }: PoloniexV2BookMessage): SequenceInfo | undefined {
    if (channel === 'book_lv2' && (action === 'snapshot' || action === 'update')) {
      return {
        key: data[0].symbol,
        sequenceId: data[0].id,
        previousSequenceId: action === 'snapshot' ? null : data[0].lastId
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
