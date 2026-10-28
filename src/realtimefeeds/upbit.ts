import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class UpbitRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://api.upbit.com/websocket/v1'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const subs = filters.map((filter) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('UpbitRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      // trade SNAPSHOT is the market's last trade, often hours old; orderbook and ticker SNAPSHOT give the current state
      return {
        type: filter.channel,
        codes: filter.symbols,
        ...(filter.channel === 'trade' ? { isOnlyRealtime: true } : {})
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
