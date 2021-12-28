import { upperCaseSymbols } from '../handy'
import { BookChange, Trade } from '../types'
import { Mapper } from './mapper'

// https://api.hitbtc.com/#socket-market-data

export const hitBtcTradesMapper: Mapper<'hitbtc', Trade> = {
  canHandle(message: HitBtcTradesMessage) {
    return message.method !== undefined && message.method === 'updateTrades'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'updateTrades',
        symbols
      }
    ]
  },

  *map(message: HitBtcTradesMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const trade of message.params.data)
      yield {
        type: 'trade',
        symbol: message.params.symbol,
        exchange: 'hitbtc',
        id: String(trade.id),
        price: Number(trade.price),
        amount: Number(trade.quantity),
        side: trade.side,
        timestamp: new Date(trade.timestamp),
        localTimestamp: localTimestamp
      }
  }
}

const mapBookLevel = (level: HitBtcBookLevel) => {
  const price = Number(level.price)
  const amount = Number(level.size)

  return { price, amount }
}

export const hitBtcBookChangeMapper: Mapper<'hitbtc', BookChange> = {
  canHandle(message: HitBtcBookMessage) {
    if (message.method === undefined) {
      return false
    }

    return message.method === 'snapshotOrderbook' || message.method === 'updateOrderbook'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'snapshotOrderbook',
        symbols
      },
      {
        channel: 'updateOrderbook',
        symbols
      }
    ]
  },

  *map(message: HitBtcBookMessage, localTimestamp: Date): IterableIterator<BookChange> {
    yield {
      type: 'book_change',
      symbol: message.params.symbol,
      exchange: 'hitbtc',
      isSnapshot: message.method === 'snapshotOrderbook',
      bids: message.params.bid.map(mapBookLevel),
      asks: message.params.ask.map(mapBookLevel),

      timestamp: new Date(message.params.timestamp),
      localTimestamp
    }
  }
}

type HitBtcMessage = {
  method?: string
}

type HitBtcTradesMessage = HitBtcMessage & {
  method: 'updateTrades'
  params: {
    data: {
      id: number
      price: string
      quantity: string
      side: 'buy' | 'sell'
      timestamp: string
    }[]
    symbol: string
  }
}

type HitBtcBookLevel = {
  price: string
  size: string
}

type HitBtcBookMessage = HitBtcMessage & {
  method: 'snapshotOrderbook' | 'updateOrderbook'
  params: {
    ask: HitBtcBookLevel[]
    bid: HitBtcBookLevel[]
    symbol: string
    timestamp: string
  }
}
