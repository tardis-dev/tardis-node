import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class BitflyerRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://ws.lightstream.bitflyer.com/json-rpc'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BitflyerRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          return {
            method: 'subscribe',
            params: {
              channel: `${filter.channel}_${symbol}`
            }
          }
        })
      })
      .flatMap((c) => c)
  }

  protected messageIsError(message: any): boolean {
    return message.method !== 'channelMessage'
  }

  protected onMessage = (msg: any) => {
    // once we've received book snapshot, let's unsubscribe from it
    if ((msg.params.channel as string).startsWith('lightning_board_snapshot')) {
      this.send({
        method: 'unsubscribe',
        params: {
          channel: msg.params.channel
        }
      })
    }
  }
}
