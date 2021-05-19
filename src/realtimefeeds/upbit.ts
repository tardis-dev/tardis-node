import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class UpbitRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://api.upbit.com/websocket/v1'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    let i = 0
    var payloads = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('UpbitRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          return {
            id: i++,
            method: filter.channel,
            params: [symbol]
          }
        })
      })
      .flatMap((s) => s)

    return payloads
  }

  protected messageIsError(message: any): boolean {
    return message.type === 'error'
  }
}
