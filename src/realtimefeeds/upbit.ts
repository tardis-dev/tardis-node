import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class UpbitRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://api.upbit.com/websocket/v1'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const subs = filters.map((filter) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('UpbitRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return {
        type: filter.channel,
        codes: filter.symbols,
        isOnlyRealtime: true
      }
    })

    const payload = [
      [
        {
          ticket: new Date().valueOf().toString()
        },
        ...subs
      ]
    ]

    return payload
  }

  protected messageIsError(message: any): boolean {
    return message.type === 'error'
  }
}
