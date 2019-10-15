import { RealTimeFeedBase } from './realtimefeed'
import { Filter } from '../types'
import WebSocket = require('ws')

export class BitflyerRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://ws.lightstream.bitflyer.com/json-rpc'

  protected mapToSubscribeMessages(filters: Filter<string>[]): string | any[] {
    return filters
      .map(filter => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BitflyerRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map(symbol => {
          return {
            method: 'subscribe',
            params: {
              channel: `${filter.channel}_${symbol}`
            }
          }
        })
      })
      .flatMap(c => c)
  }

  protected messageIsError(message: any): boolean {
    return message.method !== 'channelMessage'
  }

  protected onMessage = (msg: any, ws: WebSocket) => {
    // once we've received book snapshot, let's unsubscribe from it
    if ((msg.params.channel as string).startsWith('lightning_board_snapshot')) {
      ws.send(
        JSON.stringify({
          method: 'unsubscribe',
          params: {
            channel: msg.params.channel
          }
        })
      )
    }
  }
}
