import { RealTimeFeedBase } from './realtimefeed'
import { Filter } from '../types'

export class GeminiRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://api.gemini.com/v2/marketdata'

  protected mapToSubscribeMessages(filters: Filter<string>[]): string | any[] {
    const symbols = filters
      .map(filter => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('GeminiRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols
      })
      .flatMap(s => s)
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

  protected messageIsError(): boolean {
    return false
  }
}
