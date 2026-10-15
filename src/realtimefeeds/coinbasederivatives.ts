import { Writable } from 'node:stream'
import { batch, getJSON, optimizeFilters } from '../handy.ts'
import { Filter } from '../types.ts'
import { MultiConnectionRealTimeFeedBase, PoolingClientBase, RealTimeFeedBase } from './realtimefeed.ts'

export class CoinbaseDerivativesRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const wsFilters = optimizeFilters(filters.filter((f) => f.channel !== 'products'))
    for (const filter of wsFilters) {
      if (!['heartbeats', 'subscriptions'].includes(filter.channel) && !filter.symbols?.length) {
        throw new Error('Coinbase derivatives WebSocket subscriptions require explicit symbols')
      }
    }

    const symbols = [...new Set(wsFilters.flatMap((f) => f.symbols ?? []))]
    const groups: Iterable<string[]> = symbols.length > 0 ? batch(symbols, 25) : wsFilters.length > 0 ? [[]] : []
    for (const group of groups) {
      const groupedFilters = wsFilters
        .map((f) => ({
          ...f,
          symbols: f.symbols?.filter((s) => group.includes(s))
        }))
        .filter((f) => f.symbols?.length || ['heartbeats', 'subscriptions'].includes(f.channel))
      yield new CoinbaseDerivativesSingleConnectionRealTimeFeed(exchange, groupedFilters, timeoutIntervalMS, onError)
    }

    const productFilters = filters.filter((f) => f.channel === 'products')
    if (productFilters.length > 0) {
      const allProducts = productFilters.some((f) => !f.symbols?.length)
      yield new CoinbaseDerivativesProductsClient(
        exchange,
        allProducts ? undefined : new Set(productFilters.flatMap((f) => f.symbols!)),
        onError
      )
    }
  }
}

class CoinbaseDerivativesSingleConnectionRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://advanced-trade-ws.coinbase.com'
  private sequence?: number

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    return [
      {
        type: 'subscribe',
        channel: 'heartbeats'
      },
      ...filters
        .filter((f) => !['heartbeats', 'subscriptions'].includes(f.channel))
        .map((f) => ({
          type: 'subscribe',
          channel: f.channel === 'l2_data' ? 'level2' : f.channel,
          product_ids: f.symbols
        }))
    ]
  }

  protected async onConnected() {
    this.sequence = undefined
  }

  protected messageIsError(message: { type?: string }) {
    return message.type === 'error'
  }

  protected onMessage(message: { sequence_num?: number }) {
    if (message.sequence_num === undefined) return
    if (this.sequence !== undefined && message.sequence_num !== this.sequence + 1) {
      throw new Error(`Coinbase derivatives sequence gap: ${this.sequence} -> ${message.sequence_num}`)
    }
    this.sequence = message.sequence_num
  }
}

class CoinbaseDerivativesProductsClient extends PoolingClientBase {
  constructor(
    exchange: string,
    private readonly symbols: Set<string> | undefined,
    onError?: (error: Error) => void
  ) {
    super(exchange, 5, onError)
  }

  protected async poolDataToStream(output: Writable) {
    for (let offset = 0; !output.destroyed; offset += 100) {
      const { data } = await getJSON<{ products: Product[]; pagination: { has_next: boolean } }>(
        `https://api.coinbase.com/api/v3/brokerage/market/products?product_type=FUTURE&limit=100&offset=${offset}`
      )

      for (const product of data.products) {
        if (output.destroyed) return

        if (this.symbols === undefined || this.symbols.has(product.product_id)) {
          output.write({ channel: 'products', generated: true, events: [product] })
        }
      }
      if (!data.pagination.has_next) return
    }
  }
}

type Product = { product_id: string }
