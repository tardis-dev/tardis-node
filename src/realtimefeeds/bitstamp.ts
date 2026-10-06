import { Writable } from 'stream'
import { getJSON } from '../handy.ts'
import { Filter } from '../types.ts'
import { MultiConnectionRealTimeFeedBase, PoolingClientBase, RealTimeFeedBase } from './realtimefeed.ts'

const BITSTAMP_HTTP_URL = 'https://www.bitstamp.net/api/v2'

export class BitstampRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const wsFilters = filters.filter((f) => f.channel !== 'ticker')
    if (wsFilters.length > 0) {
      yield new BitstampWebSocketRealTimeFeed(exchange, wsFilters, timeoutIntervalMS, onError)
    }

    const tickerFilters = filters.filter((f) => f.channel === 'ticker')
    if (tickerFilters.length > 0) {
      yield new BitstampTickerClient(
        exchange,
        tickerFilters.flatMap((f) => f.symbols ?? []),
        onError
      )
    }
  }
}

// Bitstamp WebSocket has no ticker channel; the recorder polls the REST ticker and stores it in this generated message shape.
class BitstampTickerClient extends PoolingClientBase {
  constructor(
    exchange: string,
    private readonly _symbols: string[],
    onError?: (error: Error) => void
  ) {
    super(exchange, 6, onError)
  }

  protected async poolDataToStream(outputStream: Writable) {
    const { data: tickers } = await getJSON<{ market: string }[]>(`${BITSTAMP_HTTP_URL}/ticker/`, { timeout: 10000 })

    for (const ticker of tickers) {
      const symbol = ticker.market.replace('/', '').toLowerCase()
      if (this._symbols.length > 0 && this._symbols.includes(symbol) === false) {
        continue
      }

      if (outputStream.writable) {
        outputStream.write({ data: ticker, channel: `ticker_${symbol}`, event: 'ticker', generated: true })
      }
    }
  }
}

class BitstampWebSocketRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://ws.bitstamp.net'
  protected httpURL = BITSTAMP_HTTP_URL

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BitstampRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          return {
            event: 'bts:subscribe',
            data: {
              channel: `${filter.channel}_${symbol}`
            }
          }
        })
      })
      .flatMap((c) => c)
  }

  protected messageIsError(message: any): boolean {
    if (message.channel === undefined) {
      return true
    }

    if (message.event === 'bts:request_reconnect') {
      return true
    }

    return false
  }

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const orderBookFilter = filters.find((f) => f.channel === 'diff_order_book')
    if (!orderBookFilter) {
      return
    }

    this.debug('requesting manual snapshots for: %s', orderBookFilter.symbols!)

    for (let symbol of orderBookFilter.symbols!) {
      if (shouldCancel()) {
        return
      }

      const { data } = await getJSON(`${this.httpURL}/order_book/${symbol}?group=1`)
      if (shouldCancel()) {
        return
      }

      const snapshot = {
        data,
        event: 'snapshot',
        channel: `diff_order_book_${symbol}`,
        generated: true
      }

      this.manualSnapshotsBuffer.push(snapshot)
    }

    this.debug('requested manual snapshots successfully for: %s ', orderBookFilter.symbols!)
  }
}
