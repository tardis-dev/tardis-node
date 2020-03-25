import { BookChange, Trade } from '../types'
import { Mapper } from './mapper'
import { parseμs } from '../handy'

// https://docs.ftx.com/#websocket-api

export const ftxTradesMapper: Mapper<'ftx', Trade> = {
  canHandle(message: FtxTrades | FtxOrderBook) {
    if (message.data == undefined) {
      return false
    }

    return message.channel === 'trades'
  },

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'trades',
        symbols
      }
    ]
  },

  *map(ftxTrades: FtxTrades, localTimestamp: Date): IterableIterator<Trade> {
    for (const ftxTrade of ftxTrades.data) {
      const timestamp = new Date(ftxTrade.time)
      timestamp.μs = parseμs(ftxTrade.time)

      yield {
        type: 'trade',
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

export const mapBookLevel = (level: FtxBookLevel) => {
  const price = level[0]
  const amount = level[1]

  return { price, amount }
}

export const ftxBookChangeMapper: Mapper<'ftx', BookChange> = {
  canHandle(message: FtxTrades | FtxOrderBook) {
    if (message.data == undefined) {
      return false
    }

    return message.channel === 'orderbook'
  },

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'orderbook',
        symbols
      }
    ]
  },

  *map(ftxOrderBook: FtxOrderBook, localTimestamp: Date): IterableIterator<BookChange> {
    const timestamp = new Date(ftxOrderBook.data.time * 1000)
    timestamp.μs = Math.floor(ftxOrderBook.data.time * 1000000) % 1000

    yield {
      type: 'book_change',
      symbol: ftxOrderBook.market,
      exchange: 'ftx',
      isSnapshot: ftxOrderBook.type === 'partial',
      bids: ftxOrderBook.data.bids.map(mapBookLevel),
      asks: ftxOrderBook.data.asks.map(mapBookLevel),
      timestamp,
      localTimestamp
    }
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
  }[]
}

type FtxBookLevel = [number, number]

type FtxOrderBook = {
  channel: 'orderbook'
  market: string
  type: 'update' | 'partial'
  data: { time: number; bids: FtxBookLevel[]; asks: FtxBookLevel[] }
}
