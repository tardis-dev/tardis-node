import { upperCaseSymbols } from '../handy'
import { BookChange, Trade } from '../types'
import { Mapper } from './mapper'

// https://docs.gemini.com/websocket-api/#market-data-version-2

export const geminiTradesMapper: Mapper<'gemini', Trade> = {
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

export const geminiBookChangeMapper: Mapper<'gemini', BookChange> = {
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
