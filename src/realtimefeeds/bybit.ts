import { Filter } from '../types'
import { RealTimeFeedBase, MultiConnectionRealTimeFeedBase } from './realtimefeed'

export class BybitRealTimeDataFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const linearContractsFilters = filters.reduce(
      this._only((s) => s.endsWith('USDT')),
      [] as Filter<string>[]
    )

    const inverseContractsFilters = filters.reduce(
      this._only((s) => s.endsWith('USDT') === false),
      [] as Filter<string>[]
    )

    if (linearContractsFilters.length > 0) {
      yield new BybitSingleConnectionRealTimeDataFeed('realtime_public', exchange, linearContractsFilters, timeoutIntervalMS, onError)
    }

    if (inverseContractsFilters.length > 0) {
      yield new BybitSingleConnectionRealTimeDataFeed('realtime', exchange, inverseContractsFilters, timeoutIntervalMS, onError)
    }
  }

  private _only(filter: (symbol: string) => boolean) {
    return (prev: Filter<string>[], current: Filter<string>) => {
      if (!current.symbols || current.symbols.length === 0) {
        throw new Error('BybitRealTimeDataFeed requires explicitly specified symbols when subscribing to live feed')
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

class BybitSingleConnectionRealTimeDataFeed extends RealTimeFeedBase {
  protected readonly wssURL: string

  constructor(
    wsURLSuffix: string,
    exchange: string,
    filters: Filter<string>[],
    timeoutIntervalMS?: number,
    onError?: (error: Error) => void
  ) {
    super(exchange, filters, timeoutIntervalMS, onError)
    this.wssURL = `wss://stream.bybit.com/${wsURLSuffix}`
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const args = filters
      .map((filter) => {
        return filter.symbols!.map((symbol) => {
          const suffix = filter.channel === 'instrument_info' || filter.channel === 'orderBook_200' ? '.100ms' : ''
          return `${filter.channel}${suffix}.${symbol}`
        })
      })
      .flatMap((f) => f)

    return [
      {
        op: 'subscribe',
        args
      }
    ]
  }

  protected messageIsError(message: any): boolean {
    return message.success === false
  }
}
