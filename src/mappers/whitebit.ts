import { asNonZeroNumberOrUndefined, asNumberOrUndefined, fromMicroSecondsToDate, upperCaseSymbols } from '../handy.ts'
import { BookChange, BookTicker, DerivativeTicker, Trade } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'
import { exchangeMappers } from './registry.ts'

export const whitebitMappers = exchangeMappers({
  whitebit: {
    trades: () => new WhiteBitTradesMapper(),
    bookChanges: () => new WhiteBitBookChangeMapper(),
    bookTickers: () => new WhiteBitBookTickerMapper(),
    derivativeTickers: () => new WhiteBitDerivativeTickerMapper()
  }
})

class WhiteBitTradesMapper implements Mapper<'whitebit', Trade> {
  canHandle(message: WhiteBitMessage) {
    return message.method === 'trades_update'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'trades_update', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: WhiteBitTrades, localTimestamp: Date): IterableIterator<Trade> {
    const [symbol, trades] = message.params
    // Subscription backfills are newest first; live executions are incremental.
    // A singleton has no snapshot marker, so retain it rather than discard a possible live trade at replay startup.
    if (trades.length > 1 && BigInt(trades[0].id) > BigInt(trades[trades.length - 1].id)) {
      return
    }

    for (const trade of trades) {
      yield {
        type: 'trade',
        exchange: 'whitebit',
        symbol: symbol.toUpperCase(),
        id: String(trade.id),
        price: Number(trade.price),
        amount: Number(trade.amount),
        side: trade.type,
        timestamp: fromSecondsToDate(trade.time),
        localTimestamp
      }
    }
  }
}

class WhiteBitBookChangeMapper implements Mapper<'whitebit', BookChange> {
  canHandle(message: WhiteBitMessage) {
    return message.method === 'depth_update'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'depth_update', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: WhiteBitDepth, localTimestamp: Date): IterableIterator<BookChange> {
    const [isSnapshot, book, symbol] = message.params

    yield {
      type: 'book_change',
      exchange: 'whitebit',
      symbol: symbol.toUpperCase(),
      isSnapshot,
      bids: (book.bids ?? []).map(this._mapBookLevel),
      asks: (book.asks ?? []).map(this._mapBookLevel),
      timestamp: fromSecondsToDate(book.timestamp),
      localTimestamp
    }
  }

  private _mapBookLevel([price, amount]: [string, string]) {
    return {
      price: Number(price),
      amount: Number(amount)
    }
  }
}

class WhiteBitBookTickerMapper implements Mapper<'whitebit', BookTicker> {
  canHandle(message: WhiteBitMessage) {
    return message.method === 'bookTicker_update'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'bookTicker_update', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: WhiteBitBookTicker, localTimestamp: Date): IterableIterator<BookTicker> {
    for (const [transactionTime, , symbol, , bidPrice, bidAmount, askPrice, askAmount] of message.params) {
      yield {
        type: 'book_ticker',
        exchange: 'whitebit',
        symbol: symbol.toUpperCase(),
        bidPrice: asNonZeroNumberOrUndefined(bidPrice),
        bidAmount: asNonZeroNumberOrUndefined(bidAmount),
        askPrice: asNonZeroNumberOrUndefined(askPrice),
        askAmount: asNonZeroNumberOrUndefined(askAmount),
        timestamp: fromSecondsToDate(transactionTime),
        localTimestamp
      }
    }
  }
}

class WhiteBitDerivativeTickerMapper implements Mapper<'whitebit', DerivativeTicker> {
  private readonly _pendingTickers = new PendingTickerInfoHelper()
  private readonly _lastAcceptedTradeIds = new Map<string, bigint>()
  private readonly _lastPremiumTimestamps = new Map<string, number>()

  canHandle(message: WhiteBitMessage) {
    return (
      message.method === 'premiumIndex_update' ||
      message.method === 'futures_update' ||
      (message.method === 'trades_update' && (message as WhiteBitTrades).params[0].endsWith('_PERP'))
    )
  }

  getFilters(symbols?: string[]) {
    const perpetuals = upperCaseSymbols(symbols)?.filter((symbol) => symbol.endsWith('_PERP'))
    if (perpetuals?.length === 0) {
      return []
    }
    return [
      { channel: 'trades_update', symbols: perpetuals } as const,
      { channel: 'premiumIndex_update', symbols: perpetuals } as const,
      { channel: 'futures_update', symbols: perpetuals } as const
    ]
  }

  *map({ method, params }: WhiteBitPremiumIndex | WhiteBitFutures | WhiteBitTrades, localTimestamp: Date) {
    const symbol = params[0].toUpperCase()
    const ticker = this._pendingTickers.getPendingTickerInfo(symbol, 'whitebit')

    if (method === 'trades_update') {
      // Backfills can initialize the latest price, but never emit historical derivative ticker events.
      let latestTrade = params[1][0]
      for (const trade of params[1]) {
        if (BigInt(trade.id) > BigInt(latestTrade.id)) {
          latestTrade = trade
        }
      }
      if (latestTrade === undefined) {
        return
      }

      const latestTradeId = BigInt(latestTrade.id)
      const lastAcceptedTradeId = this._lastAcceptedTradeIds.get(symbol)
      if (lastAcceptedTradeId !== undefined && latestTradeId <= lastAcceptedTradeId) {
        return
      }
      this._lastAcceptedTradeIds.set(symbol, latestTradeId)
      ticker.updateLastPrice(asNumberOrUndefined(latestTrade.price))
      return
    }

    if (method === 'futures_update') {
      // REST has no trade timestamp, so use its price only until a WebSocket trade has been accepted.
      ticker.updateOpenInterest(asNumberOrUndefined(params[1].open_interest))
      if (!this._lastAcceptedTradeIds.has(symbol)) {
        ticker.updateLastPrice(asNumberOrUndefined(params[1].last_price))
      }
      return
    }

    const [, markPrice, indexPrice, fundingRate, fundingTime, serverTime] = params
    const timestamp = fromSecondsToDate(serverTime)
    const timestampMicros = timestamp.valueOf() * 1000 + (timestamp.μs ?? 0)
    const lastTimestampMicros = this._lastPremiumTimestamps.get(symbol)
    // Reject stale snapshots before changing cached values or flushing pending side-channel updates.
    if (lastTimestampMicros !== undefined && timestampMicros < lastTimestampMicros) {
      return
    }
    this._lastPremiumTimestamps.set(symbol, timestampMicros)

    ticker.updateMarkPrice(asNumberOrUndefined(markPrice))
    ticker.updateIndexPrice(asNumberOrUndefined(indexPrice))
    ticker.updateFundingRate(asNumberOrUndefined(fundingRate))
    ticker.updateFundingTimestamp(new Date(fundingTime))
    ticker.updateTimestamp(timestamp)
    if (ticker.hasChanged()) {
      yield ticker.getSnapshot(localTimestamp)
    }
  }
}

function fromSecondsToDate(seconds: string | number) {
  const [whole, fraction = ''] = String(seconds).split('.')
  return fromMicroSecondsToDate(Number(whole) * 1e6 + Number(fraction.padEnd(6, '0').slice(0, 6)))
}

type WhiteBitMessage<TMethod extends string = string, TParams = unknown> = {
  method: TMethod
  params: TParams
  id: null
}

/** @see https://docs.whitebit.com/websocket/market-streams/trades */
type WhiteBitTrades = WhiteBitMessage<
  'trades_update',
  [
    symbol: string,
    trades: {
      id: number
      time: string | number
      price: string
      amount: string
      type: 'buy' | 'sell'
      rpi?: boolean
    }[]
  ]
>

/** @see https://docs.whitebit.com/websocket/market-streams/depth */
type WhiteBitDepth = WhiteBitMessage<
  'depth_update',
  [
    isSnapshot: boolean,
    book: {
      timestamp: string | number
      event_time: string | number
      update_id: number
      past_update_id?: number
      bids?: [price: string, amount: string][]
      asks?: [price: string, amount: string][]
    },
    symbol: string
  ]
>

/** @see https://docs.whitebit.com/websocket/market-streams/book-ticker */
type WhiteBitBookTicker = WhiteBitMessage<
  'bookTicker_update',
  [
    transactionTime: string | number,
    messageTime: string | number,
    symbol: string,
    updateId: number,
    bidPrice: string,
    bidAmount: string,
    askPrice: string,
    askAmount: string
  ][]
>

/** @see https://docs.whitebit.com/websocket/market-streams/premium-index */
type WhiteBitPremiumIndex = WhiteBitMessage<
  'premiumIndex_update',
  [symbol: string, markPrice: string, indexPrice: string, fundingRate: string, fundingTime: number, serverTime: string | number]
>

/**
 * Recorder-generated envelope containing the original REST market record.
 * @see https://docs.whitebit.com/api-reference/market-data/available-futures-markets-list
 */
type WhiteBitFutures = WhiteBitMessage<
  'futures_update',
  [
    symbol: string,
    market: {
      ticker_id: string
      stock_currency: string
      money_currency: string
      last_price: string
      stock_volume: string
      money_volume: string
      bid: string
      ask: string
      high: string
      low: string
      product_type: 'Perpetual'
      open_interest: string
      mark_price: string
      index_price: string
      index_name: string
      index_currency: string
      funding_rate: string
      funding_cap: string
      funding_floor: string
      next_funding_rate_timestamp: string
      brackets: Record<string, number>
      max_leverage: number
      funding_interval_minutes: number
    }
  ]
> & { generated: true }
