import { inflateRawSync } from 'zlib'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class OkexRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://real.okex.com:8443/ws/v3'

  protected decompress = (message: any) => {
    message = inflateRawSync(message) as Buffer

    return message
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const args = filters
      .map(filter => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error(`${this.exchange} RealTimeFeed requires explicitly specified symbols when subscribing to live feed`)
        }

        return filter.symbols.map(symbol => {
          return `${filter.channel}:${symbol}`
        })
      })
      .flatMap(s => s)

    return [
      {
        op: 'subscribe',
        args
      }
    ]
  }

  protected messageIsError(message: any): boolean {
    return message.event === 'error'
  }
}

export class OKCoinRealTimeFeed extends OkexRealTimeFeed {
  protected wssURL = 'wss://real.okcoin.com:8443/ws/v3'
}
