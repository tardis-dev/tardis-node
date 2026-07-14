import { asNonZeroNumberOrUndefined, fromMicroSecondsToDate, upperCaseSymbols } from '../handy.ts'
import { BookChange, BookTicker, Trade } from '../types.ts'
import { Mapper } from './mapper.ts'
import { exchangeMappers, isRealTime, mapper } from './registry.ts'

// https://docs.gemini.com/websocket-api/#market-data-version-2
const GEMINI_V3_API_SWITCH_DATE = new Date('2026-07-07T22:00:00.000Z')

export const geminiMappers = exchangeMappers({
  gemini: {
    trades: mapper([{ until: GEMINI_V3_API_SWITCH_DATE, use: () => geminiTradesMapper }, { use: () => new GeminiV3TradesMapper() }]),
    bookChanges: mapper([
      { until: GEMINI_V3_API_SWITCH_DATE, use: () => geminiBookChangeMapper },
      {
        use: (localTimestamp) =>
          new GeminiV3BookChangeMapper({ isSnapshotDeterminedByEqualUpdateIds: isRealTime(localTimestamp) === false })
      }
    ]),
    bookTickers: () => new GeminiV3BookTickerMapper()
  }
})

const geminiTradesMapper: Mapper<'gemini', Trade> = {
  canHandle(message: GeminiL2Updates | GeminiTrade) {
    return message.type === 'trade'
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

  *map(geminiTrade: GeminiTrade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: geminiTrade.symbol,
      exchange: 'gemini',
      id: String(geminiTrade.event_id),
      price: Number(geminiTrade.price),
      amount: Number(geminiTrade.quantity),
      side: geminiTrade.side === 'buy' ? 'buy' : geminiTrade.side === 'sell' ? 'sell' : 'unknown',
      timestamp: new Date(geminiTrade.timestamp),
      localTimestamp: localTimestamp
    }
  }
}

const mapBookLevel = (level: GeminiBookLevel) => {
  const price = Number(level[1])
  const amount = Number(level[2])

  return { price, amount }
}

const geminiBookChangeMapper: Mapper<'gemini', BookChange> = {
  canHandle(message: GeminiL2Updates | GeminiTrade) {
    return message.type === 'l2_updates'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'l2_updates',
        symbols
      }
    ]
  },

  *map(geminiL2Updates: GeminiL2Updates, localTimestamp: Date): IterableIterator<BookChange> {
    yield {
      type: 'book_change',
      symbol: geminiL2Updates.symbol,
      exchange: 'gemini',
      isSnapshot: geminiL2Updates.auction_events !== undefined,
      bids: geminiL2Updates.changes.filter((c) => c[0] === 'buy').map(mapBookLevel),
      asks: geminiL2Updates.changes.filter((c) => c[0] === 'sell').map(mapBookLevel),

      timestamp: localTimestamp,
      localTimestamp
    }
  }
}

type GeminiBookLevel = ['buy' | 'sell', string, string]

type GeminiL2Updates = {
  type: 'l2_updates'
  symbol: string
  changes: GeminiBookLevel[]
  auction_events: any[]
}

type GeminiTrade = {
  type: 'trade'
  symbol: string
  event_id: number
  timestamp: number
  price: string
  quantity: string
  side: 'sell' | 'buy'
}

class GeminiV3TradesMapper implements Mapper<'gemini', Trade> {
  canHandle(message: GeminiV3Trade | GeminiV3BookTicker | GeminiV3DepthUpdate) {
    return 't' in message && !('e' in message)
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'trade', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: GeminiV3Trade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: message.s,
      exchange: 'gemini',
      id: message.t.toString(),
      price: Number(message.p),
      amount: Number(message.q),
      side: message.m ? 'sell' : 'buy',
      timestamp: fromMicroSecondsToDate(Math.floor(message.E / 1000)),
      localTimestamp
    }
  }
}

class GeminiV3BookChangeMapper implements Mapper<'gemini', BookChange> {
  private readonly previousUpdateIdBySymbol = new Map<string, number>()

  constructor(private readonly options: GeminiV3BookChangeMapperOptions) {}

  canHandle(message: GeminiV3DepthUpdate) {
    return message.e === 'depthUpdate'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'depth@100ms', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: GeminiV3DepthUpdate, localTimestamp: Date): IterableIterator<BookChange> {
    yield {
      type: 'book_change',
      symbol: message.s,
      exchange: 'gemini',
      isSnapshot: this.isSnapshot(message),
      bids: message.b.map(this.mapBookLevel),
      asks: message.a.map(this.mapBookLevel),
      timestamp: fromMicroSecondsToDate(Math.floor(message.E / 1000)),
      localTimestamp
    }
  }

  private isSnapshot(message: GeminiV3DepthUpdate) {
    if (this.options.isSnapshotDeterminedByEqualUpdateIds) {
      return message.U === message.u
    }

    const isSnapshot = this.previousUpdateIdBySymbol.has(message.s) === false
    this.previousUpdateIdBySymbol.set(message.s, message.u)
    return isSnapshot
  }

  private mapBookLevel([price, amount]: GeminiV3BookLevel) {
    return { price: Number(price), amount: Number(amount) }
  }
}

type GeminiV3BookChangeMapperOptions = {
  isSnapshotDeterminedByEqualUpdateIds: boolean
}

class GeminiV3BookTickerMapper implements Mapper<'gemini', BookTicker> {
  canHandle(message: GeminiV3Trade | GeminiV3BookTicker | GeminiV3DepthUpdate) {
    return 'u' in message && !('e' in message)
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'bookTicker', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: GeminiV3BookTicker, localTimestamp: Date): IterableIterator<BookTicker> {
    yield {
      type: 'book_ticker',
      symbol: message.s,
      exchange: 'gemini',
      askAmount: asNonZeroNumberOrUndefined(message.A),
      askPrice: asNonZeroNumberOrUndefined(message.a),
      bidAmount: asNonZeroNumberOrUndefined(message.B),
      bidPrice: asNonZeroNumberOrUndefined(message.b),
      timestamp: fromMicroSecondsToDate(Math.floor(message.E / 1000)),
      localTimestamp
    }
  }
}

/** @see https://developer.gemini.com/prediction-markets/websocket/streams#trade-stream  */
type GeminiV3Trade = {
  E: number
  s: string
  t: number
  p: string
  q: string
  m: boolean
}

/** @see https://developer.gemini.com/prediction-markets/websocket/streams#l2-differential-depth-streams */
type GeminiV3DepthUpdate = {
  e: 'depthUpdate'
  E: number
  s: string
  U: number
  u: number
  b: GeminiV3BookLevel[]
  a: GeminiV3BookLevel[]
}
type GeminiV3BookLevel = [string, string]

/** @see https://developer.gemini.com/prediction-markets/websocket/streams#book-ticker */
type GeminiV3BookTicker = {
  u: number
  E: number
  s: string
  b?: string
  B?: string
  a?: string
  A?: string
  c?: string
  C?: string
}
