import { BookChange, Trade } from '../types'
import { Mapper } from './mapper'

// https://docs.binance.org/api-reference/dex-api/ws-streams.html

export const binanceDexTradesMapper: Mapper<'binance-dex', Trade> = {
  canHandle(message: BinanceDexResponse<any>) {
    return message.stream === 'trades'
  },

  getFilters(symbols?: string[]) {
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
