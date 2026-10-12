import { asNonZeroNumberOrUndefined, asNumberOrUndefined, upperCaseSymbols } from '../handy.ts'
import { BookChange, DerivativeTicker, Exchange, Trade, BookTicker, Liquidation } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'
import { exchangeMappers, mapper } from './registry.ts'

// https://www.gate.io/docs/futures/ws/index.html

export const gateIOFuturesMappers = exchangeMappers({
  'gate-io-futures': {
    trades: () => new GateIOFuturesTradesMapper('gate-io-futures'),
    bookChanges: mapper([
      { until: new Date('2026-10-14T00:00:00.000Z'), use: () => new GateIOFuturesBookChangeMapper('gate-io-futures') },
      { use: () => new GateIOFuturesOrderBookV2Mapper() }
    ]),
    derivativeTickers: () => new GateIOFuturesDerivativeTickerMapper(),
    bookTickers: () => new GateIOFuturesBookTickerMapper('gate-io-futures'),
    liquidations: () => new GateIOFuturesLiquidationsMapper()
  }
})

class GateIOFuturesOrderBookV2Mapper implements Mapper<'gate-io-futures', BookChange> {
  canHandle(message: GateIOFuturesOrderBookV2) {
    return message.channel === 'futures.obu' && (message.event === 'update' || message.event === 'all')
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'obu', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map({ result }: GateIOFuturesOrderBookV2, localTimestamp: Date): IterableIterator<BookChange> {
    yield {
      type: 'book_change',
      symbol: result.s.slice(3, result.s.lastIndexOf('.')),
      exchange: 'gate-io-futures',
      isSnapshot: result.full === true,
      bids: (result.b ?? []).map(this.mapBookLevel),
      asks: (result.a ?? []).map(this.mapBookLevel),
      timestamp: new Date(result.t),
      localTimestamp
    }
  }

  private mapBookLevel([price, amount]: [string, string]) {
    return { price: Number(price), amount: Number(amount) }
  }
}

class GateIOFuturesLiquidationsMapper implements Mapper<'gate-io-futures', Liquidation> {
  canHandle(message: GateIOFuturesLiquidations) {
    return message.channel === 'futures.public_liquidates' && message.event === 'update'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'public_liquidates', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: GateIOFuturesLiquidations, localTimestamp: Date): IterableIterator<Liquidation> {
    for (const liquidation of message.result) {
      const size = Number(liquidation.size)
      yield {
        type: 'liquidation',
        symbol: liquidation.contract,
        exchange: 'gate-io-futures',
        id: undefined,
        price: Number(liquidation.price),
        amount: Math.abs(size),
        side: size < 0 ? 'sell' : 'buy',
        timestamp: new Date(liquidation.time),
        localTimestamp
      }
    }
  }
}

class GateIOFuturesTradesMapper implements Mapper<'gate-io-futures', Trade> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: any) {
    return message.channel === 'futures.trades' && message.event === 'update'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trades',
        symbols
      } as const
    ]
  }

  *map(tradesMessage: GateIOFuturesTrades, localTimestamp: Date): IterableIterator<Trade> {
    for (const trade of tradesMessage.result) {
      const timestamp = trade.create_time_ms !== undefined ? new Date(trade.create_time_ms) : new Date(trade.create_time * 1000)
      const size = Number(trade.size)

      yield {
        type: 'trade',
        symbol: trade.contract,
        exchange: this._exchange,
        id: trade.id.toString(),
        price: Number(trade.price),
        amount: Math.abs(size),
        side: size < 0 ? 'sell' : 'buy',
        timestamp,
        localTimestamp: localTimestamp
      }
    }
  }
}

const mapBookLevel = (level: GateIOFuturesSnapshotLevel) => {
  const price = Number(level.p)
  const size = Number(level.s)

  return { price, amount: Math.abs(size) }
}

class GateIOFuturesBookChangeMapper implements Mapper<'gate-io-futures', BookChange> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: GateIOFuturesOrderBookSnapshot | GateIOFuturesOrderBookUpdate) {
    return message.channel === 'futures.order_book' && (message.event === 'all' || message.event === 'update')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'order_book',
        symbols
      } as const
    ]
  }

  *map(depthMessage: GateIOFuturesOrderBookSnapshot | GateIOFuturesOrderBookUpdate, localTimestamp: Date): IterableIterator<BookChange> {
    if (depthMessage.event === 'all') {
      if (depthMessage.result.t === 0) {
        return
      }
      const timestamp =
        depthMessage.time_ms !== undefined
          ? new Date(depthMessage.time_ms)
          : depthMessage.result.t !== undefined
            ? new Date(depthMessage.result.t)
            : new Date(depthMessage.time * 1000)

      // snapshot
      yield {
        type: 'book_change',
        symbol: depthMessage.result.contract,
        exchange: this._exchange,
        isSnapshot: true,
        bids: depthMessage.result.bids.map(mapBookLevel),
        asks: depthMessage.result.asks.map(mapBookLevel),
        timestamp,
        localTimestamp: localTimestamp
      }
    } else if (depthMessage.result.length > 0) {
      // update
      const timestamp = depthMessage.result[0].t !== undefined ? new Date(depthMessage.result[0].t) : new Date(depthMessage.time * 1000)

      yield {
        type: 'book_change',
        symbol: depthMessage.result[0].c,
        exchange: this._exchange,
        isSnapshot: false,
        bids: depthMessage.result.filter((l) => Number(l.s) >= 0).map(mapBookLevel),
        asks: depthMessage.result.filter((l) => Number(l.s) <= 0).map(mapBookLevel),
        timestamp,
        localTimestamp: localTimestamp
      }
    }
  }
}

class GateIOFuturesDerivativeTickerMapper implements Mapper<'gate-io-futures', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: GateIOFuturesTicker) {
    return message.channel === 'futures.tickers' && message.event === 'update'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'tickers',
        symbols
      } as const
    ]
  }

  *map(message: GateIOFuturesTicker, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const tickers = Array.isArray(message.result) ? message.result : [message.result]

    for (const futuresTicker of tickers) {
      if (futuresTicker.contract === undefined) {
        return
      }
      const timestamp = message.time_ms !== undefined ? new Date(message.time_ms) : new Date(message.time * 1000)

      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(futuresTicker.contract, 'gate-io-futures')

      pendingTickerInfo.updateFundingRate(asNumberOrUndefined(futuresTicker.funding_rate))
      pendingTickerInfo.updatePredictedFundingRate(asNumberOrUndefined(futuresTicker.funding_rate_indicative))
      const fundingNextApply = asNonZeroNumberOrUndefined(futuresTicker.funding_next_apply)
      if (fundingNextApply !== undefined) {
        pendingTickerInfo.updateFundingTimestamp(new Date(fundingNextApply * 1000))
      }
      pendingTickerInfo.updateIndexPrice(Number(futuresTicker.index_price))
      pendingTickerInfo.updateMarkPrice(Number(futuresTicker.mark_price))
      pendingTickerInfo.updateLastPrice(Number(futuresTicker.last))
      pendingTickerInfo.updateTimestamp(timestamp)

      if (futuresTicker.total_size !== undefined) {
        pendingTickerInfo.updateOpenInterest(Number(futuresTicker.total_size))
      }

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

class GateIOFuturesBookTickerMapper implements Mapper<'gate-io-futures', BookTicker> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: any) {
    return message.channel === 'futures.book_ticker' && message.event === 'update'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'book_ticker',
        symbols
      } as const
    ]
  }

  *map(gateIoFuturesBookTickerMessage: GateIOFuturesBookTicker, localTimestamp: Date): IterableIterator<BookTicker> {
    const gateIoFuturesBookTicker = gateIoFuturesBookTickerMessage.result
    const askAmount = Number(gateIoFuturesBookTicker.A)
    const bidAmount = Number(gateIoFuturesBookTicker.B)

    if (gateIoFuturesBookTicker.t === 0) {
      return
    }
    const ticker: BookTicker = {
      type: 'book_ticker',
      symbol: gateIoFuturesBookTicker.s,
      exchange: this._exchange,
      askAmount: askAmount !== 0 ? askAmount : undefined,
      askPrice: gateIoFuturesBookTicker.a !== '' ? Number(gateIoFuturesBookTicker.a) : undefined,
      bidPrice: gateIoFuturesBookTicker.b !== '' ? Number(gateIoFuturesBookTicker.b) : undefined,
      bidAmount: bidAmount !== 0 ? bidAmount : undefined,
      timestamp: gateIoFuturesBookTicker.t !== undefined ? new Date(gateIoFuturesBookTicker.t) : localTimestamp,
      localTimestamp: localTimestamp
    }

    yield ticker
  }
}

type GateIOFuturesTrade = {
  size: number | string
  id: number
  create_time: number
  create_time_ms?: number
  price: string
  contract: string
}

type GateIOFuturesTrades = {
  time: number
  channel: 'futures.trades'
  event: 'update'

  result: GateIOFuturesTrade[]
}

type GateIOFuturesSnapshotLevel = { p: string; s: number | string }

type GateIOFuturesOrderBookSnapshot = {
  time: number
  channel: 'futures.order_book'
  event: 'all'
  time_ms: number | undefined
  result: {
    t?: number
    contract: string
    asks: GateIOFuturesSnapshotLevel[]
    bids: GateIOFuturesSnapshotLevel[]
  }
}

type GateIOFuturesOrderBookUpdate = {
  time: number
  channel: 'futures.order_book'
  event: 'update'
  result: {
    t?: number
    p: string
    s: number | string
    c: string
  }[]
}

type GateIOFuturesTicker = {
  time: number
  time_ms?: number
  channel: 'futures.tickers'
  event: 'update'

  result:
    | [
        {
          contract: string
          last: string
          funding_rate: string
          funding_next_apply?: number
          mark_price: string
          index_price: string
          funding_rate_indicative: string
          total_size: string | undefined
        }
      ]
    | {
        contract: string
        last: string
        funding_rate: string
        funding_next_apply?: number
        mark_price: string
        index_price: string
        funding_rate_indicative: string
        total_size: string | undefined
      }
}

type GateIOFuturesBookTicker = {
  id: null
  time: 1648771200
  channel: 'futures.book_ticker'
  event: 'update'
  error: null
  result: { t: number; u: 3502782378; s: 'BTC_USD'; b: string; B: number | string; a: string; A: number | string }
}

type GateIOFuturesOrderBookV2 = {
  channel: 'futures.obu'
  event: 'update' | 'all'
  result: {
    s: string
    t: number
    full?: boolean
    b?: [string, string][]
    a?: [string, string][]
  }
}

type GateIOFuturesLiquidations = {
  channel: 'futures.public_liquidates'
  event: 'update'
  result: { contract: string; price: string; size: string | number; time: number }[]
}
