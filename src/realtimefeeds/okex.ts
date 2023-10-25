import crypto from 'crypto'
import { wait } from '../handy'
import { Filter } from '../types'
import { MultiConnectionRealTimeFeedBase, RealTimeFeedBase } from './realtimefeed'

export class OkexRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const nonBusinessFilters = filters.filter((f) => f.channel !== 'trades-all')

    if (nonBusinessFilters.length > 0) {
      yield new OkexSingleRealTimeFeed('wss://ws.okx.com:8443/ws/v5/public', exchange, nonBusinessFilters, timeoutIntervalMS, onError)
    }

    const businessFilters = filters.filter((f) => f.channel === 'trades-all')

    if (businessFilters.length > 0) {
      yield new OkexSingleRealTimeFeed('wss://ws.okx.com:8443/ws/v5/business', exchange, businessFilters, timeoutIntervalMS, onError)
    }
  }
}

class OkexSingleRealTimeFeed extends RealTimeFeedBase {
  constructor(
    protected wssURL: string,
    exchange: string,
    filters: Filter<string>[],
    timeoutIntervalMS: number | undefined,
    onError?: (error: Error) => void
  ) {
    super(exchange, filters, timeoutIntervalMS, onError)
  }

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
      .filter((f) => f.channel != 'liquidations')
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error(`${this._exchange} RealTimeFeed requires explicitly specified symbols when subscribing to live feed`)
        }

        return filter.symbols.map((symbol) => {
          if (filter.channel === 'liquidation-orders') {
            return {
              channel: filter.channel,
              instType: symbol.endsWith('SWAP') ? 'SWAP' : 'FUTURES'
            }
          }
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

  protected isIgnoredError(message: any) {
    if (message.msg.includes('channel') && message.msg.includes(`doesn't exist`)) {
      return true
    }

    return false
  }
}

export class OKCoinRealTimeFeed extends OkexSingleRealTimeFeed {
  constructor(exchange: string, filters: Filter<string>[], timeoutIntervalMS: number | undefined, onError?: (error: Error) => void) {
    super('wss://real.okcoin.com:8443/ws/v5/public', exchange, filters, timeoutIntervalMS, onError)
  }
}

export class OkexOptionsRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const nonBusinessFilters = filters.filter((f) => f.channel !== 'trades-all')

    if (nonBusinessFilters.length > 0) {
      yield new OkexOptionsSingleRealTimeFeed(
        'wss://ws.okx.com:8443/ws/v5/public',
        exchange,
        nonBusinessFilters,
        timeoutIntervalMS,
        onError
      )
    }

    const businessFilters = filters.filter((f) => f.channel === 'trades-all')

    if (businessFilters.length > 0) {
      yield new OkexOptionsSingleRealTimeFeed('wss://ws.okx.com:8443/ws/v5/business', exchange, businessFilters, timeoutIntervalMS, onError)
    }
  }
}

class OkexOptionsSingleRealTimeFeed extends OkexSingleRealTimeFeed {
  constructor(
    protected wssURL: string,
    exchange: string,
    filters: Filter<string>[],
    timeoutIntervalMS: number | undefined,
    onError?: (error: Error) => void
  ) {
    super(wssURL, exchange, filters, timeoutIntervalMS, onError)
  }

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
            instFamily: filter.channel === 'opt-summary' ? finalSymbol : undefined
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
