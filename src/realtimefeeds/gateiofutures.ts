import type { GateIOFuturesMessage } from '../mappers/gateiofutures.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase, MultiConnectionRealTimeFeedBase, type SequenceInfo } from './realtimefeed.ts'

export class GateIOFuturesRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(
    exchange: string,
    filters: Filter<string>[],
    ...rest: [timeoutIntervalMS?: number, validateSequence?: boolean, onError?: (error: Error) => void]
  ) {
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
        ...rest
      )
    }

    if (inverseContractsFilters.length > 0) {
      yield new GateIOFuturesSingleConnectionRealTimeFeed(
        'wss://fx-ws.gateio.ws/v4/ws/btc',
        400,
        exchange,
        inverseContractsFilters,
        ...rest
      )
    }

    const usd1ContractsFilters = filters.reduce(
      this._only((s) => s.endsWith('_USD1')),
      [] as Filter<string>[]
    )
    if (usd1ContractsFilters.length > 0) {
      yield new GateIOFuturesSingleConnectionRealTimeFeed('wss://fx-ws.gateio.ws/v4/ws/usd1', 400, exchange, usd1ContractsFilters, ...rest)
    }

    // Gate has no public liquidations channel for delivery futures
    if (filters.every((filter) => filter.channel === 'public_liquidates' && filter.symbols!.every((s) => /_USDT_\d{8}$/.test(s)))) {
      throw new Error('Gate.io delivery futures do not support public_liquidates')
    }
    const deliveryContractsFilters = filters
      .filter((filter) => filter.channel !== 'public_liquidates')
      .reduce(
        this._only((s) => /_USDT_\d{8}$/.test(s)),
        [] as Filter<string>[]
      )
    if (deliveryContractsFilters.length > 0) {
      yield new GateIOFuturesSingleConnectionRealTimeFeed(
        'wss://fx-ws.gateio.ws/v4/ws/delivery/usdt',
        100,
        exchange,
        deliveryContractsFilters,
        ...rest
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
  private readonly receivedSnapshots = new Set<string>()

  constructor(
    protected readonly wssURL: string,
    private readonly orderBookDepth: 100 | 400,
    ...rest: ConstructorParameters<typeof RealTimeFeedBase>
  ) {
    super(...rest)
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    this.receivedSnapshots.clear()
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

  protected getSequence(message: GateIOFuturesMessage): SequenceInfo | undefined {
    if (message.channel === 'futures.obu' && (message.event === 'update' || message.event === 'all')) {
      return {
        key: message.result.s,
        sequenceId: message.result.u,
        previousSequenceId: message.result.full === true ? null : message.result.U! - 1
      }
    }

    return undefined
  }

  protected onMessage(message: GateIOFuturesMessage) {
    if (message.channel !== 'futures.obu' || (message.event !== 'update' && message.event !== 'all')) {
      return
    }

    const { result } = message
    if (!Number.isSafeInteger(result.u) || (result.full !== true && (!Number.isSafeInteger(result.U) || result.u < result.U!))) {
      throw new Error(`Invalid Gate.io OBU sequence range for ${result.s}: U=${result.U}, u=${result.u}`)
    }
    if (result.full === true) {
      this.receivedSnapshots.add(result.s)
    } else if (!this.receivedSnapshots.has(result.s)) {
      throw new Error(`Gate.io OBU snapshot required for ${result.s}`)
    }
  }

  protected messageIsError(message: any): boolean {
    if (message.error !== null && message.error !== undefined) {
      return true
    }

    return false
  }
}
