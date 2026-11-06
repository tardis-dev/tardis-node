import type { GeminiMessage } from '../mappers/gemini.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase, type SequenceInfo } from './realtimefeed.ts'

export class GeminiRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://ws.gemini.com?snapshot=-1'
  private readonly channels = new Set(['trade', 'depth', 'bookTicker'])
  private readonly previousUpdateIds = new Map<string, number>()

  protected getSequence(message: GeminiMessage): SequenceInfo | undefined {
    if ('e' in message && message.e === 'depthUpdate') {
      const previous = this.previousUpdateIds.get(message.s)
      if (previous === undefined) {
        this.previousUpdateIds.set(message.s, message.u)
        return {
          key: message.s,
          sequenceId: message.u,
          previousSequenceId: null
        }
      }
      if (previous < message.u) {
        this.previousUpdateIds.set(message.s, message.u)
        return {
          key: message.s,
          sequenceId: message.u,
          previousSequenceId: previous + 1 >= message.U ? previous : message.U - 1
        }
      }
    }

    return undefined
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    this.previousUpdateIds.clear()
    const params = filters
      .flatMap((filter) => {
        if (!this.channels.has(filter.channel)) {
          throw new Error(`GeminiRealTimeFeed unsupported channel ${filter.channel}`)
        }

        if (!Array.isArray(filter.symbols) || filter.symbols.length === 0) {
          throw new Error('GeminiRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        const channel = filter.channel === 'depth' ? 'depth@100ms' : filter.channel
        return filter.symbols.map((symbol) => `${symbol.toLowerCase()}@${channel}`)
      })
      .filter((value, index, self) => {
        return self.indexOf(value) === index
      })

    return [
      {
        method: 'SUBSCRIBE',
        params,
        id: 1
      }
    ]
  }

  protected messageIsError(message: any): boolean {
    return message.result === 'error' || message.error !== undefined || message.status >= 400
  }
}
