import { asNonZeroNumberOrUndefined, parseμs, upperCaseSymbols } from '../handy.ts'
import { BookChange, BookTicker, Trade } from '../types.ts'
import { Mapper } from './mapper.ts'
import { exchangeMappers, mapper } from './registry.ts'

// https://www.kraken.com/features/websocket-api
const KRAKEN_V2_API_SWITCH_DATE = new Date('2026-07-10T00:00:00.000Z')

export const krakenMappers = exchangeMappers({
  kraken: {
    trades: mapper([{ until: KRAKEN_V2_API_SWITCH_DATE, use: () => krakenTradesMapper }, { use: () => new KrakenV2TradesMapper() }]),
    bookChanges: mapper([
      { until: KRAKEN_V2_API_SWITCH_DATE, use: () => krakenBookChangeMapper },
      { use: () => new KrakenV2BookChangeMapper() }
    ]),
    bookTickers: mapper([
      { until: KRAKEN_V2_API_SWITCH_DATE, use: () => krakenBookTickerMapper },
      { use: () => new KrakenV2BookTickerMapper() }
    ])
  }
})

const krakenTradesMapper: Mapper<'kraken', Trade> = {
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

const krakenBookChangeMapper: Mapper<'kraken', BookChange> = {
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

const krakenBookTickerMapper: Mapper<'kraken', BookTicker> = {
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

      askAmount: asNonZeroNumberOrUndefined(askVolume),
      askPrice: asNonZeroNumberOrUndefined(ask),

      bidPrice: asNonZeroNumberOrUndefined(bid),
      bidAmount: asNonZeroNumberOrUndefined(bidVolume),
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

/** @see https://docs.kraken.com/api/docs/websocket-v2/trade */
class KrakenV2TradesMapper implements Mapper<'kraken', Trade> {
  canHandle(message: KrakenV2Trades) {
    return message.channel === 'trade' && message.type === 'update'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'trade', symbols } as const]
  }

  *map(message: KrakenV2Trades, localTimestamp: Date): IterableIterator<Trade> {
    for (const trade of message.data) {
      const timestamp = new Date(trade.timestamp)
      timestamp.μs = parseμs(trade.timestamp)

      yield {
        type: 'trade',
        symbol: trade.symbol,
        exchange: 'kraken',
        id: trade.trade_id.toString(),
        price: trade.price,
        amount: trade.qty,
        side: trade.side,
        timestamp,
        localTimestamp
      }
    }
  }
}

/** @see https://docs.kraken.com/api/docs/websocket-v2/book */
class KrakenV2BookChangeMapper implements Mapper<'kraken', BookChange> {
  canHandle(message: KrakenV2Book) {
    return message.channel === 'book'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'book', symbols } as const]
  }

  *map(message: KrakenV2Book, localTimestamp: Date): IterableIterator<BookChange> {
    for (const book of message.data) {
      const timestamp = new Date(book.timestamp)
      timestamp.μs = parseμs(book.timestamp)

      yield {
        type: 'book_change',
        symbol: book.symbol,
        exchange: 'kraken',
        isSnapshot: message.type === 'snapshot',
        bids: book.bids?.map(this.mapBookLevel) ?? [],
        asks: book.asks?.map(this.mapBookLevel) ?? [],
        timestamp,
        localTimestamp
      }
    }
  }

  private mapBookLevel(level: KrakenV2BookLevel) {
    return {
      price: level.price,
      amount: level.qty
    }
  }
}

/** @see https://docs.kraken.com/api/docs/websocket-v2/ticker  */
class KrakenV2BookTickerMapper implements Mapper<'kraken', BookTicker> {
  canHandle(message: KrakenV2Ticker) {
    return message.channel === 'ticker'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'ticker', symbols } as const]
  }

  *map(message: KrakenV2Ticker, localTimestamp: Date): IterableIterator<BookTicker> {
    for (const tickerMessage of message.data) {
      const timestamp = new Date(tickerMessage.timestamp)
      timestamp.μs = parseμs(tickerMessage.timestamp)

      yield {
        type: 'book_ticker',
        symbol: tickerMessage.symbol,
        exchange: 'kraken',
        askAmount: tickerMessage.ask_qty === 0 ? undefined : tickerMessage.ask_qty,
        askPrice: tickerMessage.ask === 0 ? undefined : tickerMessage.ask,
        bidPrice: tickerMessage.bid === 0 ? undefined : tickerMessage.bid,
        bidAmount: tickerMessage.bid_qty === 0 ? undefined : tickerMessage.bid_qty,
        timestamp,
        localTimestamp
      }
    }
  }
}

type KrakenV2Message<Channel extends string, Data> = {
  channel: Channel
  type: 'snapshot' | 'update'
  data: Data[]
}

type KrakenV2Trades = KrakenV2Message<
  'trade',
  {
    symbol: string
    side: 'buy' | 'sell'
    price: number
    qty: number
    ord_type?: string
    trade_id: number
    timestamp: string
  }
>

type KrakenV2Book = KrakenV2Message<
  'book',
  {
    symbol: string
    bids?: KrakenV2BookLevel[]
    asks?: KrakenV2BookLevel[]
    checksum?: number
    timestamp: string
  }
>

type KrakenV2BookLevel = {
  price: number
  qty: number
}

type KrakenV2Ticker = KrakenV2Message<
  'ticker',
  {
    symbol: string
    bid: number
    bid_qty: number
    ask: number
    ask_qty: number
    last: number
    volume: number
    vwap: number
    low: number
    high: number
    change: number
    change_pct: number
    timestamp: string
  }
>
