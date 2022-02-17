import { asNumberIfValid, upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, Trade } from '../types'
import { Mapper } from './mapper'

// https://www.kraken.com/features/websocket-api

export const krakenTradesMapper: Mapper<'kraken', Trade> = {
  canHandle(message: KrakenTrades) {
    if (!Array.isArray(message)) {
      return false
    }

    const channel = message[message.length - 2] as string
    return channel === 'trade'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trade',
        symbols
      }
    ]
  },

  *map(message: KrakenTrades, localTimestamp: Date): IterableIterator<Trade> {
    const [_, trades, __, symbol] = message

    for (const [price, amount, time, side] of trades) {
      const timeExchange = Number(time)
      const timestamp = new Date(timeExchange * 1000)
      timestamp.μs = Math.floor(timeExchange * 1000000) % 1000

      yield {
        type: 'trade',
        symbol,
        exchange: 'kraken',
        id: undefined,
        price: Number(price),
        amount: Number(amount),
        side: side === 'b' ? 'buy' : 'sell',
        timestamp,
        localTimestamp
      }
    }
  }
}

const mapBookLevel = (level: KrakenBookLevel) => {
  const [price, amount] = level

  return { price: Number(price), amount: Number(amount) }
}

const getLatestTimestamp = (bids: KrakenBookLevel[], asks: KrakenBookLevel[]): Date => {
  const timestampsSorted = [...bids.map((b) => Number(b[2])), ...asks.map((b) => Number(b[2]))].sort()
  const lastBookUpdateTime = timestampsSorted[timestampsSorted.length - 1]

  const timestamp = new Date(lastBookUpdateTime * 1000)
  timestamp.μs = Math.floor(lastBookUpdateTime * 1000000) % 1000

  return timestamp
}

export const krakenBookChangeMapper: Mapper<'kraken', BookChange> = {
  canHandle(message: KrakenBookSnapshot | KrakenBookUpdate) {
    if (!Array.isArray(message)) {
      return false
    }

    const channel = message[message.length - 2] as string
    return channel.startsWith('book')
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'book',
        symbols
      }
    ]
  },

  *map(message: KrakenBookSnapshot | KrakenBookUpdate, localTimestamp: Date): IterableIterator<BookChange> {
    if ('as' in message[1]) {
      // we've got snapshot message
      const [_, { as, bs }, __, symbol] = message

      yield {
        type: 'book_change',
        symbol: symbol,
        exchange: 'kraken',
        isSnapshot: true,

        bids: bs.map(mapBookLevel),
        asks: as.map(mapBookLevel),
        timestamp: getLatestTimestamp(as, bs),
        localTimestamp: localTimestamp
      }
    } else {
      // we've got update message
      const symbol = message[message.length - 1] as string
      const asks = 'a' in message[1] ? message[1].a : []
      const bids = 'b' in message[1] ? message[1].b : typeof message[2] !== 'string' && 'b' in message[2] ? message[2].b : []

      yield {
        type: 'book_change',
        symbol,
        exchange: 'kraken',
        isSnapshot: false,

        bids: bids.map(mapBookLevel),
        asks: asks.map(mapBookLevel),
        timestamp: getLatestTimestamp(asks, bids),
        localTimestamp: localTimestamp
      }
    }
  }
}

export const krakenBookTickerMapper: Mapper<'kraken', BookTicker> = {
  canHandle(message: KrakenSpread) {
    if (!Array.isArray(message)) {
      return false
    }

    const channel = message[message.length - 2] as string
    return channel === 'spread'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'spread',
        symbols
      }
    ]
  },

  *map(message: KrakenSpread, localTimestamp: Date): IterableIterator<BookTicker> {
    const [bid, ask, time, bidVolume, askVolume] = message[1]
    const timeExchange = Number(time)

    if (timeExchange === 0) {
      return
    }
    const timestamp = new Date(timeExchange * 1000)
    timestamp.μs = Math.floor(timeExchange * 1000000) % 1000

    const ticker: BookTicker = {
      type: 'book_ticker',
      symbol: message[3],
      exchange: 'kraken',

      askAmount: asNumberIfValid(askVolume),
      askPrice: asNumberIfValid(ask),

      bidPrice: asNumberIfValid(bid),
      bidAmount: asNumberIfValid(bidVolume),
      timestamp,
      localTimestamp: localTimestamp
    }

    yield ticker
  }
}

type KrakenTrades = [number, [string, string, string, 's' | 'b', string, string][], string, string]
type KrakenBookLevel = [string, string, string]
type KrakenBookSnapshot = [
  number,
  {
    as: KrakenBookLevel[]
    bs: KrakenBookLevel[]
  },
  string,
  string
]

type KrakenBookUpdate =
  | [
      number,

      (
        | {
            a: KrakenBookLevel[]
          }
        | {
            b: KrakenBookLevel[]
          }
      ),
      string,
      string
    ]
  | [
      number,

      {
        a: KrakenBookLevel[]
      },
      {
        b: KrakenBookLevel[]
      },
      string,
      string
    ]

type KrakenSpread = [
  325,
  [bid: '43770.20000', ask: '43770.30000', timestamp: '1633053779.916349', bidVolume: '0.00917717', askVolume: '0.31670440'],
  'spread',
  'XBT/USD'
]
