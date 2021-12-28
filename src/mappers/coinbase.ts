import { parseμs, upperCaseSymbols } from '../handy'
import { BookChange, BookPriceLevel, BookTicker, Trade } from '../types'
import { Mapper } from './mapper'

// https://docs.pro.coinbase.com/#websocket-feed

export const coinbaseTradesMapper: Mapper<'coinbase', Trade> = {
  canHandle(message: CoinbaseTrade | CoinbaseLevel2Snapshot | CoinbaseLevel2Update) {
    return message.type === 'match'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'match',
        symbols
      }
    ]
  },

  *map(message: CoinbaseTrade, localTimestamp: Date): IterableIterator<Trade> {
    const timestamp = new Date(message.time)
    timestamp.μs = parseμs(message.time)

    yield {
      type: 'trade',
      symbol: message.product_id,
      exchange: 'coinbase',
      id: String(message.trade_id),
      price: Number(message.price),
      amount: Number(message.size),
      side: message.side === 'sell' ? 'buy' : 'sell', // coinbase side field indicates the maker order side
      timestamp,
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

const validAmountsOnly = (level: BookPriceLevel) => {
  if (Number.isNaN(level.amount)) {
    return false
  }
  if (level.amount < 0) {
    return false
  }

  return true
}

export class CoinbaseBookChangMapper implements Mapper<'coinbase', BookChange> {
  private readonly _symbolLastTimestampMap = new Map<string, Date>()

  canHandle(message: CoinbaseTrade | CoinbaseLevel2Snapshot | CoinbaseLevel2Update) {
    return message.type === 'l2update' || message.type === 'snapshot'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'snapshot',
        symbols
      } as const,
      {
        channel: 'l2update',
        symbols
      } as const
    ]
  }

  *map(message: CoinbaseLevel2Update | CoinbaseLevel2Snapshot, localTimestamp: Date): IterableIterator<BookChange> {
    if (message.type === 'snapshot') {
      yield {
        type: 'book_change',
        symbol: message.product_id,
        exchange: 'coinbase',
        isSnapshot: true,
        bids: message.bids.map(mapSnapshotBookLevel).filter(validAmountsOnly),
        asks: message.asks.map(mapSnapshotBookLevel).filter(validAmountsOnly),
        timestamp: localTimestamp,
        localTimestamp
      }
    } else {
      // in very rare cases, Coinbase was returning timestamps that aren't valid, like: "time":"0001-01-01T00:00:00.000000Z"
      // but l2update message was still valid and we need to process it, in such case use timestamp of previous message
      let timestamp = new Date(message.time)
      if (timestamp.valueOf() < 0) {
        let previousValidTimestamp = this._symbolLastTimestampMap.get(message.product_id)
        if (previousValidTimestamp === undefined) {
          return
        }
        timestamp = previousValidTimestamp
      } else {
        timestamp.μs = parseμs(message.time)
        this._symbolLastTimestampMap.set(message.product_id, timestamp)
      }

      yield {
        type: 'book_change',
        symbol: message.product_id,
        exchange: 'coinbase',
        isSnapshot: false,
        bids: message.changes.filter((c) => c[0] === 'buy').map(mapUpdateBookLevel),
        asks: message.changes.filter((c) => c[0] === 'sell').map(mapUpdateBookLevel),
        timestamp,
        localTimestamp: localTimestamp
      }
    }
  }
}

export const coinbaseBookTickerMapper: Mapper<'coinbase', BookTicker> = {
  canHandle(message: CoinbaseTicker) {
    return message.type === 'ticker'
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

  *map(message: CoinbaseTicker, localTimestamp: Date): IterableIterator<BookTicker> {
    let timestamp = new Date(message.time)

    if (message.time === undefined || timestamp.valueOf() < 0) {
      timestamp = localTimestamp
    } else {
      timestamp.μs = parseμs(message.time)
    }

    yield {
      type: 'book_ticker',
      symbol: message.product_id,
      exchange: 'coinbase',
      askAmount: undefined,
      askPrice: message.best_ask !== undefined ? Number(message.best_ask) : undefined,
      bidPrice: message.best_bid !== undefined ? Number(message.best_bid) : undefined,
      bidAmount: undefined,
      timestamp,
      localTimestamp: localTimestamp
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

type CoinbaseTicker = {
  type: 'ticker'
  sequence: 2349290585
  product_id: 'CGLD-USD'
  price: '5.415'
  best_bid: '5.4149'
  best_ask: '5.4150'
  time: '2021-10-13T07:05:00.028961Z'
}
