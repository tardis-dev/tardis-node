import crypto from 'crypto'
import { wait } from '../handy'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class OkexSpreadsRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://ws.okx.com:8443/ws/v5/business'

  private _hasCredentials = process.env.OKX_API_KEY !== undefined

  private secondsSinceEpoch() {
    return Math.floor(Date.now() / 1000)
  }

  protected async onConnected() {
    if (this._hasCredentials) {
      const timestamp = this.secondsSinceEpoch().toString()
      const sign = crypto.createHmac('sha256', process.env.OKX_API_SECRET_KEY!).update(`${timestamp}GET/users/self/verify`).digest('base64')

      this.send({
        op: 'login',
        args: [
          {
            apiKey: process.env.OKX_API_KEY,
            passphrase: process.env.OKX_API_PASSPHRASE,
            timestamp,
            sign
          }
        ]
      })

      await wait(50)
    }
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const args = filters

      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error(`${this._exchange} RealTimeFeed requires explicitly specified symbols when subscribing to live feed`)
        }

        return filter.symbols.map((symbol) => {
          return {
            channel: filter.channel,
            sprdId: symbol
          }
        })
      })
      .flatMap((s) => s)

    return [
      {
        op: 'subscribe',
        args: [...new Set(args)]
      }
    ]
  }

  protected messageIsError(message: any): boolean {
    return message.event === 'error'
  }
}
