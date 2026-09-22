import { fromMicroSecondsToDate, upperCaseSymbols } from '../handy.ts'
import { BookChange, BookPriceLevel, Trade } from '../types.ts'
import { Mapper } from './mapper.ts'
import { exchangeMappers } from './registry.ts'

export const bithumbMappers = exchangeMappers({
  bithumb: {
    trades: () => new BithumbTradesMapper(),
    bookChanges: () => new BithumbBookChangeMapper()
  }
})

class BithumbTradesMapper implements Mapper<'bithumb', Trade> {
  canHandle(message: BithumbTrade) {
    return message.type === 'trade' && message.stream_type === 'REALTIME'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'trade', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: BithumbTrade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: message.code,
      exchange: 'bithumb',
      id: message.sequential_id,
      price: message.trade_price,
      amount: message.trade_volume,
      side: message.ask_bid === 'ASK' ? 'sell' : 'buy',
      timestamp: new Date(message.trade_timestamp),
      localTimestamp
    }
  }
}

class BithumbBookChangeMapper implements Mapper<'bithumb', BookChange> {
  canHandle(message: BithumbOrderBook) {
    return message.type === 'orderbook'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'orderbook', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: BithumbOrderBook, localTimestamp: Date): IterableIterator<BookChange> {
    const asks: BookPriceLevel[] = []
    const bids: BookPriceLevel[] = []

    for (const level of message.orderbook_units) {
      if (level.ask_price > 0 && level.ask_size > 0) {
        asks.push({ price: level.ask_price, amount: level.ask_size })
      }

      if (level.bid_price > 0 && level.bid_size > 0) {
        bids.push({ price: level.bid_price, amount: level.bid_size })
      }
    }

    yield {
      type: 'book_change',
      symbol: message.code,
      exchange: 'bithumb',
      isSnapshot: true,
      asks,
      bids,
      timestamp: fromMicroSecondsToDate(message.timestamp),
      localTimestamp
    }
  }
}

/** @see https://apidocs.bithumb.com/reference/%EC%B2%B4%EA%B2%B0-trade */
type BithumbTrade = {
  type: 'trade'
  code: string
  trade_price: number
  trade_volume: number
  ask_bid: 'ASK' | 'BID'
  prev_closing_price: number
  change: 'RISE' | 'EVEN' | 'FALL'
  change_price: number
  trade_date: string
  trade_time: string
  trade_timestamp: number
  /** Bithumb sends this as a JSON number, but ingestion preserves it as a string because it exceeds Number.MAX_SAFE_INTEGER. */
  sequential_id: string
  timestamp: number
  stream_type: BithumbStreamType
}

/** @see https://apidocs.bithumb.com/reference/%ED%98%B8%EA%B0%80-orderbook */
type BithumbOrderBook = {
  type: 'orderbook'
  code: string
  total_ask_size: number
  total_bid_size: number
  orderbook_units: { ask_price: number; bid_price: number; ask_size: number; bid_size: number }[]
  timestamp: number
  level: number
  stream_type: BithumbStreamType
}

type BithumbStreamType = 'SNAPSHOT' | 'REALTIME'
