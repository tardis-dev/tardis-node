import { Mapper } from './mapper'
import { Trade, BookChange } from '../types'

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
      yield {
        type: 'trade',
        symbol: ftxTrades.market,
        exchange: 'ftx',
        id: ftxTrade.id !== null ? String(ftxTrade.id) : undefined,
        price: ftxTrade.price,
        amount: ftxTrade.size,
        side: ftxTrade.side,
        timestamp: new Date(ftxTrade.time),
        localTimestamp: localTimestamp
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
    yield {
      type: 'book_change',
      symbol: ftxOrderBook.market,
      exchange: 'ftx',
      isSnapshot: ftxOrderBook.type === 'partial',
      bids: ftxOrderBook.data.bids.map(mapBookLevel),
      asks: ftxOrderBook.data.asks.map(mapBookLevel),
      timestamp: new Date(Math.floor(ftxOrderBook.data.time * 1000)),
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
