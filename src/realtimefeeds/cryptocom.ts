import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class CryptoComRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://stream.crypto.com/v2/market'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const channels = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('CryptoComRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          const suffix = filter.channel === 'book' ? '.150' : ''
          return `${filter.channel}.${symbol}${suffix}`
        })
      })
      .flatMap((s) => s)

    return [
      {
        id: 1,
        method: 'subscribe',
        nonce: new Date().valueOf(),
        params: {
          channels: channels
        }
      }
    ]
  }

  protected messageIsError(message: any): boolean {
    return message.code !== undefined && message.code !== 0
  }

  protected onMessage(msg: any) {
    if (msg.method === 'public/heartbeat') {
      this.send({
        id: msg.id,
        method: 'public/respond-heartbeat'
      })
    }
  }
  protected messageIsHeartbeat(msg: any) {
    return msg.method === 'public/heartbeat'
  }
}
