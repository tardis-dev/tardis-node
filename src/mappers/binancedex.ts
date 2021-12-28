import { upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, Trade } from '../types'
import { Mapper } from './mapper'

// https://docs.binance.org/api-reference/dex-api/ws-streams.html

export const binanceDexTradesMapper: Mapper<'binance-dex', Trade> = {
  canHandle(message: BinanceDexResponse<any>) {
    return message.stream === 'trades'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trades',
        symbols
      }
    ]
  },

  *map(binanceDexTradeResponse: BinanceDexResponse<BinanceDexTradeData>, localTimestamp: Date): IterableIterator<Trade> {
    for (const binanceDexTrade of binanceDexTradeResponse.data) {
      yield {
        type: 'trade',
        symbol: binanceDexTrade.s,
        exchange: 'binance-dex',
        id: binanceDexTrade.t,
        price: Number(binanceDexTrade.p),
        amount: Number(binanceDexTrade.q),
        side: binanceDexTrade.tt === 2 ? 'sell' : 'buy',
        timestamp: new Date(Math.floor(binanceDexTrade.T / 1000000)),
        localTimestamp: localTimestamp
      }
    }
  }
}

const mapBookLevel = (level: BinanceDexBookLevel) => {
  const price = Number(level[0])
  const amount = Number(level[1])
  return { price, amount }
}

export const binanceDexBookChangeMapper: Mapper<'binance-dex', BookChange> = {
  canHandle(message: BinanceDexResponse<any>) {
    return message.stream === 'marketDiff' || message.stream === 'depthSnapshot'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'depthSnapshot',
        symbols
      },
      {
        channel: 'marketDiff',
        symbols
      }
    ]
  },

  *map(
    message: BinanceDexResponse<BinanceDexDepthSnapshotData | BinanceDexMarketDiffData>,
    localTimestamp: Date
  ): IterableIterator<BookChange> {
    if ('symbol' in message.data) {
      // we've got snapshot message
      yield {
        type: 'book_change',
        symbol: message.data.symbol,
        exchange: 'binance-dex',
        isSnapshot: true,
        bids: message.data.bids.map(mapBookLevel),
        asks: message.data.asks.map(mapBookLevel),
        timestamp: localTimestamp,
        localTimestamp
      }
    } else {
      // we've got update
      yield {
        type: 'book_change',
        symbol: message.data.s,
        exchange: 'binance-dex',
        isSnapshot: false,
        bids: message.data.b.map(mapBookLevel),
        asks: message.data.a.map(mapBookLevel),
        timestamp: localTimestamp,
        localTimestamp
      }
    }
  }
}

export const binanceDexBookTickerMapper: Mapper<'binance-dex', BookTicker> = {
  canHandle(message: BinanceDexResponse<any>) {
    return message.stream === 'ticker'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'ticker',
        symbols
      }
    ]
  },

  *map(binanceDexTradeResponse: BinanceDexResponse<BinanceDexTickerData>, localTimestamp: Date): IterableIterator<BookTicker> {
    const binanceDexTicker = binanceDexTradeResponse.data

    const ticker: BookTicker = {
      type: 'book_ticker',
      symbol: binanceDexTicker.s,
      exchange: 'binance-dex',

      askAmount: binanceDexTicker.A !== undefined ? Number(binanceDexTicker.A) : undefined,
      askPrice: binanceDexTicker.a !== undefined ? Number(binanceDexTicker.a) : undefined,
      bidPrice: binanceDexTicker.b !== undefined ? Number(binanceDexTicker.b) : undefined,
      bidAmount: binanceDexTicker.B !== undefined ? Number(binanceDexTicker.B) : undefined,
      timestamp: binanceDexTicker.E !== undefined ? new Date(binanceDexTicker.E * 1000) : localTimestamp,
      localTimestamp: localTimestamp
    }

    yield ticker
  }
}

type BinanceDexResponse<T> = {
  stream: string
  data: T
}

type BinanceDexTradeData = {
  s: string // Symbol
  t: string // Trade ID
  p: string // Price
  q: string // Quantity
  T: number // Trade time

  tt: number //tiekertype 0: Unknown 1: SellTaker 2: BuyTaker 3: BuySurplus 4: SellSurplus 5: Neutral
}[]

type BinanceDexBookLevel = [string, string]

type BinanceDexDepthSnapshotData = {
  symbol: string
  bids: BinanceDexBookLevel[]
  asks: BinanceDexBookLevel[]
}

type BinanceDexMarketDiffData = {
  E: number // Event time
  s: string // Symbol
  b: BinanceDexBookLevel[]
  a: BinanceDexBookLevel[]
}

type BinanceDexTickerData = {
  e: '24hrTicker' // Event type
  E: 123456789 // Event time
  s: 'ABC_0DX-BNB' // Symbol

  b: '0.0024' // Best bid price
  B: '10' // Best bid quantity
  a: '0.0026' // Best ask price
  A: '100' // Best ask quantity
}
