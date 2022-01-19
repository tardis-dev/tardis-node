import { asNumberIfValid, parseμs, upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, DerivativeTicker, Exchange, Liquidation, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://docs.ftx.com/#websocket-api

export class FTXTradesMapper implements Mapper<'ftx' | 'ftx-us', Trade> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: FtxTrades | FtxOrderBook) {
    if (message.data == undefined) {
      return false
    }

    return message.channel === 'trades'
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

  *map(ftxTrades: FtxTrades, localTimestamp: Date): IterableIterator<Trade> {
    for (const ftxTrade of ftxTrades.data) {
      const timestamp = new Date(ftxTrade.time)
      timestamp.μs = parseμs(ftxTrade.time)

      yield {
        type: 'trade',
        symbol: ftxTrades.market,
        exchange: this._exchange,
        id: ftxTrade.id !== null ? String(ftxTrade.id) : undefined,
        price: ftxTrade.price,
        amount: ftxTrade.size,
        side: ftxTrade.side,
        timestamp,
        localTimestamp
      }
    }
  }
}

export const mapBookLevel = (level: FtxBookLevel) => {
  const price = level[0]
  const amount = level[1]

  return { price, amount }
}

export class FTXBookChangeMapper implements Mapper<'ftx' | 'ftx-us', BookChange> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: FtxTrades | FtxOrderBook) {
    if (message.data == undefined) {
      return false
    }

    return message.channel === 'orderbook'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'orderbook',
        symbols
      } as const
    ]
  }

  *map(ftxOrderBook: FtxOrderBook, localTimestamp: Date): IterableIterator<BookChange> {
    const isEmptyUpdate = ftxOrderBook.type === 'update' && ftxOrderBook.data.bids.length === 0 && ftxOrderBook.data.asks.length === 0
    if (isEmptyUpdate) {
      return
    }

    const timestamp = new Date(ftxOrderBook.data.time * 1000)
    timestamp.μs = Math.floor(ftxOrderBook.data.time * 1000000) % 1000

    yield {
      type: 'book_change',
      symbol: ftxOrderBook.market,
      exchange: this._exchange,
      isSnapshot: ftxOrderBook.type === 'partial',
      bids: ftxOrderBook.data.bids.map(mapBookLevel),
      asks: ftxOrderBook.data.asks.map(mapBookLevel),
      timestamp,
      localTimestamp
    }
  }
}

export class FTXDerivativeTickerMapper implements Mapper<'ftx', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: FTXInstrument) {
    if (message.data == undefined) {
      return false
    }

    return message.channel === 'instrument'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'instrument',
        symbols: symbols !== undefined ? symbols.filter((s) => s.includes('/') === false) : undefined
      } as const
    ]
  }

  *map(message: FTXInstrument, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.market, this._exchange)
    const { stats, info } = message.data

    const currentFundingTimestamp = pendingTickerInfo.getCurrentFundingTimestamp()
    const updatedFundingTimestamp = stats.nextFundingTime !== undefined ? new Date(stats.nextFundingTime) : undefined

    // due to how instrument info messages are sourced (from REST API) it can sometimes return data that is stale (cached perhaps by the API)
    // let's skip such messages
    const isStaleInfo =
      updatedFundingTimestamp !== undefined &&
      currentFundingTimestamp !== undefined &&
      currentFundingTimestamp.valueOf() > updatedFundingTimestamp.valueOf()

    if (isStaleInfo) {
      return
    }

    if (updatedFundingTimestamp !== undefined) {
      pendingTickerInfo.updateFundingTimestamp(updatedFundingTimestamp)
      pendingTickerInfo.updateFundingRate(stats.nextFundingRate)
    }

    pendingTickerInfo.updateIndexPrice(info.index)
    pendingTickerInfo.updateMarkPrice(info.mark)
    pendingTickerInfo.updateLastPrice(info.last)
    pendingTickerInfo.updateOpenInterest(stats.openInterest)
    pendingTickerInfo.updateTimestamp(localTimestamp)

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

export class FTXLiquidationsMapper implements Mapper<'ftx', Liquidation> {
  canHandle(message: FtxTrades | FtxOrderBook) {
    if (message.data == undefined) {
      return false
    }

    return message.channel === 'trades'
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

  *map(ftxTrades: FtxTrades, localTimestamp: Date): IterableIterator<Liquidation> {
    for (const ftxTrade of ftxTrades.data) {
      if (ftxTrade.liquidation) {
        const timestamp = new Date(ftxTrade.time)
        timestamp.μs = parseμs(ftxTrade.time)

        yield {
          type: 'liquidation',
          symbol: ftxTrades.market,
          exchange: 'ftx',
          id: ftxTrade.id !== null ? String(ftxTrade.id) : undefined,
          price: ftxTrade.price,
          amount: ftxTrade.size,
          side: ftxTrade.side,
          timestamp,
          localTimestamp
        }
      }
    }
  }
}

export class FTXBookTickerMapper implements Mapper<'ftx' | 'ftx-us', BookTicker> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: FTXTicker) {
    if (message.data == undefined) {
      return false
    }

    return message.channel === 'ticker'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'ticker',
        symbols
      } as const
    ]
  }

  *map(ftxTicker: FTXTicker, localTimestamp: Date): IterableIterator<BookTicker> {
    const timestamp = new Date(ftxTicker.data.time * 1000)
    timestamp.μs = Math.floor(ftxTicker.data.time * 1000000) % 1000

    const ticker: BookTicker = {
      type: 'book_ticker',
      symbol: ftxTicker.market,
      exchange: this._exchange,

      askAmount: asNumberIfValid(ftxTicker.data.askSize),
      askPrice: asNumberIfValid(ftxTicker.data.ask),

      bidPrice: asNumberIfValid(ftxTicker.data.bid),
      bidAmount: asNumberIfValid(ftxTicker.data.bidSize),
      timestamp,
      localTimestamp: localTimestamp
    }

    yield ticker
  }
}

type FtxTrades = {
  channel: 'trades'
  market: string
  type: 'update'
  data: {
    id: number | null
    price: number
    size: number
    side: 'buy' | 'sell'
    time: string
    liquidation?: boolean
  }[]
}

type FtxBookLevel = [number, number]

type FtxOrderBook = {
  channel: 'orderbook'
  market: string
  type: 'update' | 'partial'
  data: { time: number; bids: FtxBookLevel[]; asks: FtxBookLevel[] }
}

type FTXInstrument = {
  channel: 'instrument'
  market: string
  type: 'update'
  data: {
    stats: {
      nextFundingRate?: number
      nextFundingTime?: string
      openInterest: number
    }
    info: {
      last: number
      mark: number
      index: number
    }
  }
}

type FTXTicker = {
  channel: 'ticker'
  market: string
  type: 'update'
  data: { bid: number; ask: number; bidSize: number; askSize: number; last: number; time: number }
}
