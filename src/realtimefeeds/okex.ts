import { inflateRawSync } from 'zlib'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class OkexRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://ws.okex.com:8443/ws/v5/public'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const args = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error(`${this._exchange} RealTimeFeed requires explicitly specified symbols when subscribing to live feed`)
        }

        return filter.symbols.map((symbol) => {
          return {
            channel: filter.channel,
            instId: symbol
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

export class OKCoinRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://real.okcoin.com:8443/ws/v3'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const args = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error(`${this._exchange} RealTimeFeed requires explicitly specified symbols when subscribing to live feed`)
        }

        return filter.symbols.map((symbol) => {
          return `${filter.channel}:${symbol}`
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

  protected decompress = (message: any) => {
    message = inflateRawSync(message) as Buffer

    return message
  }
}

export class OkexOptionsRealTimeFeed extends OkexRealTimeFeed {
  private _defaultIndexes = ['BTC-USD', 'ETH-USD']

  private _channelRequiresIndexNotSymbol(channel: string) {
    if (channel === 'index-tickers' || channel === 'opt-summary') {
      return true
    }
    return false
  }
  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const args = filters
      .map((filter) => {
        let symbols = filter.symbols || []
        const channelRequiresIndexNotSymbol = this._channelRequiresIndexNotSymbol(filter.channel)

        if (symbols.length === 0 && channelRequiresIndexNotSymbol) {
          symbols = this._defaultIndexes
        }

        if (symbols.length === 0) {
          throw new Error(`${this._exchange} RealTimeFeed requires explicitly specified symbols when subscribing to live feed`)
        }

        return symbols.map((symbol) => {
          let finalSymbol = symbol
          if (channelRequiresIndexNotSymbol) {
            const symbolParts = symbol.split('-')
            finalSymbol = `${symbolParts[0]}-${symbolParts[1]}`
          }
          return {
            channel: filter.channel,
            instId: filter.channel !== 'opt-summary' ? finalSymbol : undefined,
            uly: filter.channel === 'opt-summary' ? finalSymbol : undefined
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
}
