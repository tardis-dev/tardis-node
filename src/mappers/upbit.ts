import { upperCaseSymbols } from '../handy'
import { BookChange, BookPriceLevel, Trade } from '../types'
import { Mapper } from './mapper'

export class UpbitTradesMapper implements Mapper<'upbit', Trade> {
  canHandle(message: UpbitTrade) {
    return message.type === 'trade'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trade',
        symbols
      } as const
    ]
  }

  *map(message: UpbitTrade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: message.code,
      exchange: 'upbit',
      id: String(message.sequential_id),
      price: message.trade_price,
      amount: message.trade_volume,
      side: message.ask_bid === 'ASK' ? 'sell' : 'buy',
      timestamp: new Date(message.trade_timestamp),
      localTimestamp: localTimestamp
    }
  }
}

export class UpbitBookChangeMapper implements Mapper<'upbit', BookChange> {
  canHandle(message: UpbitOrderBook) {
    return message.type === 'orderbook'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'orderbook',
        symbols
      } as const
    ]
  }

  *map(message: UpbitOrderBook, localTimestamp: Date): IterableIterator<BookChange> {
    let asks: BookPriceLevel[] = []
    let bids: BookPriceLevel[] = []

    for (const level of message.orderbook_units) {
      if (level.ask_price > 0) {
        asks.push({
          price: level.ask_price,
          amount: level.ask_size
        })
      }

      if (level.bid_price > 0) {
        bids.push({
          price: level.bid_price,
          amount: level.bid_size
        })
      }
    }
    yield {
      type: 'book_change',
      symbol: message.code,
      exchange: 'upbit',
      isSnapshot: true,
      bids,
      asks,
      timestamp: new Date(message.timestamp),
      localTimestamp
    }
  }
}

type UpbitTrade = {
  type: 'trade'
  code: 'KRW-DOGE'
  timestamp: 1614729599905
  trade_date: '2021-03-02'
  trade_time: '23:59:59'
  trade_timestamp: 1614729599000
  trade_price: 58.4
  trade_volume: 836.12040133
  ask_bid: 'ASK'
  prev_closing_price: 57.5
  change: 'RISE'
  change_price: 0.9
  sequential_id: 1614729599000000
  stream_type: 'REALTIME'
}

type UpbitOrderBook = {
  type: 'orderbook'
  code: 'KRW-DOT'
  timestamp: 1614729599677
  total_ask_size: 1415.12521016
  total_bid_size: 8058.44442437
  orderbook_units: { ask_price: number; bid_price: number; ask_size: number; bid_size: number }[]
  stream_type: 'REALTIME'
}
