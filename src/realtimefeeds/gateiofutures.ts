import { Filter } from '../types.ts'
import { RealTimeFeedBase, MultiConnectionRealTimeFeedBase } from './realtimefeed.ts'

export class GateIOFuturesRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const linearContractsFilters = filters.reduce(
      this._only((s) => s.endsWith('_USDT')),
      [] as Filter<string>[]
    )

    const inverseContractsFilters = filters.reduce(
      this._only((s) => s.endsWith('_USD')),
      [] as Filter<string>[]
    )

    if (linearContractsFilters.length > 0) {
      yield new GateIOFuturesSingleConnectionRealTimeFeed(
        'wss://fx-ws.gateio.ws/v4/ws/usdt',
        400,
        exchange,
        linearContractsFilters,
        timeoutIntervalMS,
        onError
      )
    }

    if (inverseContractsFilters.length > 0) {
      yield new GateIOFuturesSingleConnectionRealTimeFeed(
        'wss://fx-ws.gateio.ws/v4/ws/btc',
        400,
        exchange,
        inverseContractsFilters,
        timeoutIntervalMS,
        onError
      )
    }

    const usd1ContractsFilters = filters.reduce(
      this._only((s) => s.endsWith('_USD1')),
      [] as Filter<string>[]
    )
    if (usd1ContractsFilters.length > 0) {
      yield new GateIOFuturesSingleConnectionRealTimeFeed(
        'wss://fx-ws.gateio.ws/v4/ws/usd1',
        400,
        exchange,
        usd1ContractsFilters,
        timeoutIntervalMS,
        onError
      )
    }

    const deliveryContractsFilters = filters.reduce(
      this._only((s) => /_USDT_\d{8}$/.test(s)),
      [] as Filter<string>[]
    )
    if (deliveryContractsFilters.length > 0) {
      if (deliveryContractsFilters.some((filter) => filter.channel === 'public_liquidates')) {
        throw new Error('Gate.io delivery futures do not support public_liquidates')
      }
      yield new GateIOFuturesSingleConnectionRealTimeFeed(
        'wss://fx-ws.gateio.ws/v4/ws/delivery/usdt',
        100,
        exchange,
        deliveryContractsFilters,
        timeoutIntervalMS,
        onError
      )
    }
  }

  private _only(filter: (symbol: string) => boolean) {
    return (prev: Filter<string>[], current: Filter<string>) => {
      if (!current.symbols || current.symbols.length === 0) {
        throw new Error('GateIOFuturesRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }
      for (const symbol of current.symbols) {
        if (!/_(USD|USDT|USD1)$/.test(symbol) && !/_USDT_\d{8}$/.test(symbol)) {
          throw new Error(`Unsupported Gate.io futures symbol: ${symbol}`)
        }
      }

      const symbols = current.symbols.filter(filter)
      if (symbols.length > 0) {
        prev.push({
          channel: current.channel,
          symbols
        })
      }
      return prev
    }
  }
}

class GateIOFuturesSingleConnectionRealTimeFeed extends RealTimeFeedBase {
  protected readonly extraHeaders = { 'X-Gate-Size-Decimal': '1' }

  constructor(
    protected readonly wssURL: string,
    private readonly orderBookDepth: 100 | 400,
    exchange: string,
    filters: Filter<string>[],
    timeoutIntervalMS?: number,
    onError?: (error: Error) => void
  ) {
    super(exchange, filters, timeoutIntervalMS, onError)
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const payload = filters.flatMap((filter) => {
      if (filter.channel === 'order_book' || filter.channel === 'obu') {
        return filter.symbols!.map((symbol) => {
          return {
            event: 'subscribe',
            channel: `futures.${filter.channel}`,
            payload: filter.channel === 'obu' ? [`ob.${symbol}.${this.orderBookDepth}`] : [symbol, '20', '0'],
            time: Math.floor(new Date().valueOf() / 1000)
          }
        })
      } else {
        return [
          {
            event: 'subscribe',
            channel: `futures.${filter.channel}`,
            payload: filter.symbols,
            time: Math.floor(new Date().valueOf() / 1000)
          }
        ]
      }
    })

    return payload
  }

  protected messageIsError(message: any): boolean {
    if (message.error !== null && message.error !== undefined) {
      return true
    }

    return false
  }
}
