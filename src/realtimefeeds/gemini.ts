import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class GeminiRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://ws.gemini.com?snapshot=-1'
  private readonly channels = new Set(['trade', 'depth@100ms', 'bookTicker', 'contractStatus'])

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const params = filters
      .flatMap((filter) => {
        if (!this.channels.has(filter.channel)) {
          throw new Error(`GeminiRealTimeFeed unsupported channel ${filter.channel}`)
        }

        if (filter.channel === 'contractStatus') {
          return ['contractStatus']
        }

        if (Array.isArray(filter.symbols) === false || filter.symbols.length === 0) {
          throw new Error('GeminiRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => `${symbol.toLowerCase()}@${filter.channel}`)
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
