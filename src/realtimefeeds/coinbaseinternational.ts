import crypto from 'crypto'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class CoinbaseInternationalRealTimeFeed extends RealTimeFeedBase {
  private _hasCredentials =
    process.env.COINBASE_INTERNATIONAL_API_KEY !== undefined &&
    process.env.COINBASE_INTERNATIONAL_API_SECRET !== undefined &&
    process.env.COINBASE_INTERNATIONAL_API_PASSPHRASE !== undefined

  protected get wssURL() {
    return 'wss://ws-md.international.coinbase.com'
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    if (this._hasCredentials == false) {
      throw new Error(
        'CoinbaseInternationalRealTimeFeed requires auth credentials env vars set(COINBASE_INTERNATIONAL_API_KEY, COINBASE_INTERNATIONAL_API_SECRET, COINBASE_INTERNATIONAL_API_PASSPHRASE)'
      )
    }

    const authParams = this.getAuthParams()

    return filters.map((filter) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('CoinbaseInternationalRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return {
        type: 'SUBSCRIBE',
        product_ids: filter.symbols,
        channels: [filter.channel],
        signature: authParams.signature,
        key: authParams.key,
        time: authParams.time,
        passphrase: authParams.passphrase
      }
    })
  }

  private getAuthParams() {
    const time = Math.floor(Date.now().valueOf() / 1000)
    const apiSecret = process.env.COINBASE_INTERNATIONAL_API_SECRET!
    const message = `${time}${process.env.COINBASE_INTERNATIONAL_API_KEY}CBINTLMD${process.env.COINBASE_INTERNATIONAL_API_PASSPHRASE}`

    const hmac = crypto.createHmac('sha256', Buffer.from(apiSecret, 'base64'))
    const signature = hmac.update(message).digest('base64')

    return {
      signature,
      key: process.env.COINBASE_INTERNATIONAL_API_KEY!,
      passphrase: process.env.COINBASE_INTERNATIONAL_API_PASSPHRASE!,
      time
    }
  }

  protected messageIsError(message: any): boolean {
    return message.type === 'REJECT'
  }
}
