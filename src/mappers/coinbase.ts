import { BookChange, Trade } from '../types'
import { Mapper } from './mapper'

// https://docs.pro.coinbase.com/#websocket-feed

export const coinbaseTradesMapper: Mapper<'coinbase', Trade> = {
  canHandle(message: CoinbaseTrade | CoinbaseLevel2Snapshot | CoinbaseLevel2Update) {
    return message.type === 'match'
  },

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'match',
        symbols
      }
    ]
  },

  *map(message: CoinbaseTrade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: message.product_id,
      exchange: 'coinbase',
      id: String(message.trade_id),
      price: Number(message.price),
      amount: Number(message.size),
      side: message.side === 'sell' ? 'buy' : 'sell', // coinbase side field indicates the maker order side
      timestamp: new Date(message.time),
      localTimestamp: localTimestamp
    }
  }
}

const mapUpdateBookLevel = (level: CoinbaseUpdateBookLevel) => {
  const price = Number(level[1])
  const amount = Number(level[2])

  return { price, amount }
}

const mapSnapshotBookLevel = (level: CoinbaseSnapshotBookLevel) => {
  const price = Number(level[0])
  const amount = Number(level[1])

  return { price, amount }
}

export const coinbaseBookChangMapper: Mapper<'coinbase', BookChange> = {
  canHandle(message: CoinbaseTrade | CoinbaseLevel2Snapshot | CoinbaseLevel2Update) {
    return message.type === 'l2update' || message.type === 'snapshot'
  },

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'snapshot',
        symbols
      },
      {
        channel: 'l2update',
        symbols
      }
    ]
  },

  *map(message: CoinbaseLevel2Update | CoinbaseLevel2Snapshot, localTimestamp: Date): IterableIterator<BookChange> {
    if (message.type === 'snapshot') {
      yield {
        type: 'book_change',
        symbol: message.product_id,
        exchange: 'coinbase',
        isSnapshot: true,
        bids: message.bids.map(mapSnapshotBookLevel),
        asks: message.asks.map(mapSnapshotBookLevel),
        timestamp: localTimestamp,
        localTimestamp
      }
    } else {
      yield {
        type: 'book_change',
        symbol: message.product_id,
        exchange: 'coinbase',
        isSnapshot: false,
        bids: message.changes.filter(c => c[0] === 'buy').map(mapUpdateBookLevel),
        asks: message.changes.filter(c => c[0] === 'sell').map(mapUpdateBookLevel),
        timestamp: new Date(message.time),
        localTimestamp: localTimestamp
      }
    }
  }
}

type CoinbaseTrade = {
  type: 'match'
  trade_id: number
  time: string
  product_id: string
  size: string
  price: string
  side: 'sell' | 'buy'
}

type CoinbaseSnapshotBookLevel = [string, string]

type CoinbaseLevel2Snapshot = {
  type: 'snapshot'
  product_id: string
  bids: CoinbaseSnapshotBookLevel[]
  asks: CoinbaseSnapshotBookLevel[]
}

type CoinbaseUpdateBookLevel = ['buy' | 'sell', string, string]

type CoinbaseLevel2Update = {
  type: 'l2update'
  product_id: string
  time: string
  changes: CoinbaseUpdateBookLevel[]
}
