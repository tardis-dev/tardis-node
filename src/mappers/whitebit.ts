import { asNonZeroNumberOrUndefined, asNumberOrUndefined, fromMicroSecondsToDate, isNullOrEmptyArray, upperCaseSymbols } from '../handy.ts'
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
    if (trades.length > 1 && trades[0].id > trades[trades.length - 1].id) {
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
        timestamp: fromMicroSecondsToDate(Math.round(trade.time * 1e6)),
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
      timestamp: fromMicroSecondsToDate(Math.round(book.timestamp * 1e6)),
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
        timestamp: fromMicroSecondsToDate(Math.round(transactionTime * 1e6)),
        localTimestamp
      }
    }
  }
}

class WhiteBitDerivativeTickerMapper implements Mapper<'whitebit', DerivativeTicker> {
  private readonly _pendingTickers = new PendingTickerInfoHelper()
  private readonly _symbolsWithTrades = new Set<string>()

  canHandle(message: WhiteBitMessage) {
    return (
      message.method === 'premiumIndex_update' ||
      message.method === 'futures_update' ||
      (message.method === 'trades_update' && (message as WhiteBitTrades).params[0].endsWith('_PERP'))
    )
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    const perpetuals = symbols?.filter((symbol) => symbol.endsWith('_PERP')) ?? []

    return [
      { channel: 'trades_update', symbols } as const,
      ...(isNullOrEmptyArray(symbols) || perpetuals.length > 0
        ? [{ channel: 'premiumIndex_update', symbols: perpetuals } as const, { channel: 'futures_update', symbols: perpetuals } as const]
        : [])
    ]
  }

  *map({ method, params }: WhiteBitPremiumIndex | WhiteBitFutures | WhiteBitTrades, localTimestamp: Date) {
    const symbol = params[0].toUpperCase()
    const ticker = this._pendingTickers.getPendingTickerInfo(symbol, 'whitebit')

    if (method === 'trades_update') {
      // Backfills can initialize the latest price, but never emit historical derivative ticker events.
      let latestTrade = params[1][0]
      for (const trade of params[1]) {
        if (trade.id > latestTrade.id) {
          latestTrade = trade
        }
      }
      if (latestTrade === undefined) {
        return
      }

      this._symbolsWithTrades.add(symbol)
      ticker.updateLastPrice(asNumberOrUndefined(latestTrade.price))
      return
    }

    if (method === 'futures_update') {
      // REST has no trade timestamp, so use its price only until a WebSocket trade has been accepted.
      ticker.updateOpenInterest(asNumberOrUndefined(params[1].open_interest))
      if (!this._symbolsWithTrades.has(symbol)) {
        ticker.updateLastPrice(asNumberOrUndefined(params[1].last_price))
      }
      return
    }

    const [, markPrice, indexPrice, fundingRate, fundingTime, serverTime] = params
    ticker.updateMarkPrice(asNumberOrUndefined(markPrice))
    ticker.updateIndexPrice(asNumberOrUndefined(indexPrice))
    ticker.updateFundingRate(asNumberOrUndefined(fundingRate))
    ticker.updateFundingTimestamp(new Date(fundingTime))
    ticker.updateTimestamp(fromMicroSecondsToDate(Math.round(serverTime * 1e6)))
    if (ticker.hasChanged()) {
      yield ticker.getSnapshot(localTimestamp)
    }
  }
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
      time: number
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
      timestamp: number
      event_time: number
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
    transactionTime: number,
    messageTime: number,
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
  [symbol: string, markPrice: string, indexPrice: string, fundingRate: string, fundingTime: number, serverTime: number]
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
