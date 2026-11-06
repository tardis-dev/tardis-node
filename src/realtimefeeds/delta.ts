import type { DeltaMessage } from '../mappers/delta.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase, type SequenceInfo } from './realtimefeed.ts'

export class DeltaRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://socket.delta.exchange'

  protected getSequence(message: DeltaMessage): SequenceInfo | undefined {
    if (message.type === 'l2_updates' && (message.action === 'snapshot' || message.action === 'update')) {
      return { key: message.symbol, sequenceId: message.sequence_no, previousSequenceId: message.sequence_no - 1 }
    }

    return undefined
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    return filters.map((filter) => {
      return {
        type: 'subscribe',
        payload: {
          channels: [
            {
              name: filter.channel,
              symbols:
                filter.symbols !== undefined && filter.channel === 'mark_price' ? filter.symbols.map((s) => `MARK:${s}`) : filter.symbols
            }
          ]
        }
      }
    })
  }

  protected messageIsError(message: any): boolean {
    return message.error !== undefined && message.error !== null
  }

  protected sendCustomPing = () => {
    this.send({ type: 'ping' })
  }

  protected messageIsHeartbeat(msg: any) {
    return msg.type === 'pong'
  }
}
