import type { GateIOMessage } from '../mappers/gateio.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase, type SequenceInfo } from './realtimefeed.ts'

export class GateIORealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://api.gateio.ws/ws/v4/'
  protected httpURL = 'https://api.gateio.ws/api/v4'

  protected getSequence(message: GateIOMessage): SequenceInfo | undefined {
    if ('channel' in message && message.channel === 'spot.obu' && message.event === 'update') {
      return {
        key: message.result.s.split('.')[1],
        sequenceId: message.result.u,
        previousSequenceId: message.result.U == null ? null : message.result.U - 1
      }
    }

    return undefined
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const payload = filters.map((filter) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('GateIORealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      if (filter.channel === 'obu') {
        return filter.symbols!.map((symbol) => {
          return {
            time: new Date().valueOf(),
            channel: `spot.${filter.channel}`,
            event: 'subscribe',
            payload: [`ob.${symbol}.400`]
          }
        })
      } else {
        return filter.symbols!.map((symbol) => {
          return {
            time: new Date().valueOf(),
            channel: `spot.${filter.channel}`,
            event: 'subscribe',
            method: `${filter.channel}.subscribe`,
            payload: [symbol]
          }
        })
      }
    })

    return payload.flatMap((f) => f)
  }

  protected messageIsError(message: any): boolean {
    if (message.error !== null && message.error !== undefined) {
      return true
    }

    return false
  }
}
