import { Filter } from '../types'
import { RealTimeFeedBase, MultiConnectionRealTimeFeedBase } from './realtimefeed'

export class GateIOFuturesRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const linearContractsFilters = filters.reduce(
      this._only((s) => s.endsWith('_USDT')),
      [] as Filter<string>[]
    )

    const inverseContractsFilters = filters.reduce(
      this._only((s) => s.endsWith('_USDT') === false),
      [] as Filter<string>[]
    )

    if (linearContractsFilters.length > 0) {
      yield new GateIOFuturesSingleConnectionRealTimeFeed('usdt', exchange, linearContractsFilters, timeoutIntervalMS, onError)
    }

    if (inverseContractsFilters.length > 0) {
      yield new GateIOFuturesSingleConnectionRealTimeFeed('btc', exchange, inverseContractsFilters, timeoutIntervalMS, onError)
    }
  }

  private _only(filter: (symbol: string) => boolean) {
    return (prev: Filter<string>[], current: Filter<string>) => {
      if (!current.symbols || current.symbols.length === 0) {
        throw new Error('GateIOFuturesRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
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
  protected readonly wssURL: string

  constructor(
    wsURLSuffix: string,
    exchange: string,
    filters: Filter<string>[],
    timeoutIntervalMS?: number,
    onError?: (error: Error) => void
  ) {
    super(exchange, filters, timeoutIntervalMS, onError)
    this.wssURL = `wss://fx-ws.gateio.ws/v4/ws/${wsURLSuffix}`
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const payload = filters.flatMap((filter) => {
      if (filter.channel === 'order_book') {
        return filter.symbols!.map((symbol) => {
          return {
            event: 'subscribe',
            channel: `futures.${filter.channel}`,
            payload: [symbol, '20', '0'],
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
