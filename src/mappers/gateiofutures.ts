import { upperCaseSymbols } from '../handy'
import { BookChange, DerivativeTicker, Exchange, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://www.gate.io/docs/futures/ws/index.html

export class GateIOFuturesTradesMapper implements Mapper<'gate-io-futures', Trade> {
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
      const timestamp = new Date(trade.create_time * 1000)

      yield {
        type: 'trade',
        symbol: trade.contract,
        exchange: this._exchange,
        id: trade.id.toString(),
        price: Number(trade.price),
        amount: Math.abs(trade.size),
        side: trade.size < 0 ? 'sell' : 'buy',
        timestamp,
        localTimestamp: localTimestamp
      }
    }
  }
}

const mapBookLevel = (level: GateIOFuturesSnapshotLevel) => {
  const price = Number(level.p)

  return { price, amount: Math.abs(level.s) }
}

export class GateIOFuturesBookChangeMapper implements Mapper<'gate-io-futures', BookChange> {
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
      // snapshot
      yield {
        type: 'book_change',
        symbol: depthMessage.result.contract,
        exchange: this._exchange,
        isSnapshot: true,
        bids: depthMessage.result.bids.map(mapBookLevel),
        asks: depthMessage.result.asks.map(mapBookLevel),
        timestamp: new Date(depthMessage.time * 1000),
        localTimestamp: localTimestamp
      }
    } else if (depthMessage.result.length > 0) {
      // update
      yield {
        type: 'book_change',
        symbol: depthMessage.result[0].c,
        exchange: this._exchange,
        isSnapshot: false,
        bids: depthMessage.result.filter((l) => l.s >= 0).map(mapBookLevel),
        asks: depthMessage.result.filter((l) => l.s <= 0).map(mapBookLevel),
        timestamp: new Date(depthMessage.time * 1000),
        localTimestamp: localTimestamp
      }
    }
  }
}

export class GateIOFuturesDerivativeTickerMapper implements Mapper<'gate-io-futures', DerivativeTicker> {
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
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(futuresTicker.contract, 'gate-io-futures')

      pendingTickerInfo.updateFundingRate(Number(futuresTicker.funding_rate))
      pendingTickerInfo.updatePredictedFundingRate(Number(futuresTicker.funding_rate_indicative))
      pendingTickerInfo.updateIndexPrice(Number(futuresTicker.index_price))
      pendingTickerInfo.updateMarkPrice(Number(futuresTicker.mark_price))
      pendingTickerInfo.updateLastPrice(Number(futuresTicker.last))
      pendingTickerInfo.updateTimestamp(new Date(message.time * 1000))

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

type GateIOFuturesTrade = {
  size: number
  id: number
  create_time: number
  price: string
  contract: string
}

type GateIOFuturesTrades = {
  time: number
  channel: 'futures.trades'
  event: 'update'

  result: GateIOFuturesTrade[]
}

type GateIOFuturesSnapshotLevel = { p: string; s: number }

type GateIOFuturesOrderBookSnapshot = {
  time: number
  channel: 'futures.order_book'
  event: 'all'

  result: {
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
    p: string
    s: number
    c: string
  }[]
}

type GateIOFuturesTicker = {
  time: number
  channel: 'futures.tickers'
  event: 'update'

  result:
    | [
        {
          contract: string
          last: string
          funding_rate: string
          mark_price: string
          index_price: string
          funding_rate_indicative: string
        }
      ]
    | {
        contract: string
        last: string
        funding_rate: string
        mark_price: string
        index_price: string
        funding_rate_indicative: string
      }
}
