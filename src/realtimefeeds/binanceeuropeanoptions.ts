import { onlyUnique } from '../handy'
import { Filter } from '../types'
import { MultiConnectionRealTimeFeedBase, RealTimeFeedBase } from './realtimefeed'

export class BinanceEuropeanOptionsRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    // V2 API uses two separate WebSocket endpoints:
    // 1. Public path: for optionTrade, depth20, bookTicker, optionTicker
    // 2. Market path: for optionIndexPrice, optionMarkPrice, optionOpenInterest

    const publicChannels = ['optionTrade', 'depth20', 'bookTicker', 'optionTicker']
    const marketChannels = ['optionIndexPrice', 'optionMarkPrice', 'optionOpenInterest']

    const publicFilters = filters.filter((f) => publicChannels.includes(f.channel))
    const marketFilters = filters.filter((f) => marketChannels.includes(f.channel))

    if (publicFilters.length > 0) {
      yield new BinanceEuropeanOptionsSingleFeed(
        'wss://fstream.binance.com/public/stream',
        exchange,
        publicFilters,
        filters, // Pass all filters so we can look up optionTicker when processing optionOpenInterest
        timeoutIntervalMS,
        onError
      )
    }

    if (marketFilters.length > 0) {
      yield new BinanceEuropeanOptionsSingleFeed(
        'wss://fstream.binance.com/market/stream',
        exchange,
        marketFilters,
        filters, // Pass all filters so we can look up optionTicker when processing optionOpenInterest
        timeoutIntervalMS,
        onError
      )
    }
  }
}

class BinanceEuropeanOptionsSingleFeed extends RealTimeFeedBase {
  constructor(
    protected wssURL: string,
    exchange: string,
    filters: Filter<string>[],
    private readonly _allFilters: Filter<string>[],
    timeoutIntervalMS: number | undefined,
    onError?: (error: Error) => void
  ) {
    super(exchange, filters, timeoutIntervalMS, onError)
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const payload = filters.map((filter, index) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('BinanceEuropeanOptionsRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return {
        method: 'SUBSCRIBE',
        params: filter.symbols
          .map((symbol) => {
            const lowerSymbol = symbol.toLowerCase()

            // Public path channels - use lowercase symbol directly
            if (filter.channel === 'optionTrade') {
              return [`${lowerSymbol}@${filter.channel}`]
            }

            if (filter.channel === 'depth20') {
              return [`${lowerSymbol}@${filter.channel}@100ms`]
            }

            if (filter.channel === 'bookTicker') {
              return [`${lowerSymbol}@${filter.channel}`]
            }

            if (filter.channel === 'optionTicker') {
              return [`${lowerSymbol}@${filter.channel}`]
            }

            // Market path channels - use lowercase underlying
            if (filter.channel === 'optionIndexPrice' || filter.channel === 'optionMarkPrice') {
              // Symbol is the underlying (e.g., 'btcusdt')
              return [`${lowerSymbol}@${filter.channel}`]
            }

            if (filter.channel === 'optionOpenInterest') {
              // Need to extract expirations from option symbols
              // The symbol here is the underlying (e.g., 'btcusdt')
              // We need to find all option symbols that match this underlying to extract expirations

              // Look for optionTicker filter in all filters to get actual option symbols
              const optionTickerFilter = this._allFilters.find((f) => f.channel === 'optionTicker')

              if (optionTickerFilter !== undefined) {
                // Extract expirations from option symbols that match this underlying
                const underlyingBase = lowerSymbol.replace('usdt', '').toUpperCase()

                const expirations = optionTickerFilter
                  .symbols!.filter((s) => s.toUpperCase().startsWith(underlyingBase + '-'))
                  .map((s) => {
                    const symbolParts = s.split('-')
                    return symbolParts[1] // Extract expiration (e.g., '251219')
                  })
                  .filter(onlyUnique)
                  .map((exp) => exp.toLowerCase())

                return expirations.map((expiration) => {
                  return `${lowerSymbol}@${filter.channel}@${expiration}`
                })
              }
            }

            return [`${lowerSymbol}@${filter.channel}`]
          })
          .flatMap((s) => s),
        id: index + 1
      }
    })

    return payload
  }

  protected messageIsError(message: any): boolean {
    if (message.data !== undefined && message.data.e === 'error') {
      return true
    }

    return false
  }
}
