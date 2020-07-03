import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class GeminiRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://api.gemini.com/v2/marketdata'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const symbols = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('GeminiRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols
      })
      .flatMap((s) => s)
      .filter((value, index, self) => {
        return self.indexOf(value) === index
      })

    return [
      {
        type: 'subscribe',
        subscriptions: [
          {
            name: 'l2',
            symbols
          }
        ]
      }
    ]
  }

  protected messageIsError(message: any): boolean {
    return message.result === 'error'
  }
}
