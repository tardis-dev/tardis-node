import { upperCaseSymbols } from '../handy.ts'
import { BookChange, BookPriceLevel, BookTicker, Trade } from '../types.ts'
import { Mapper } from './mapper.ts'
import { exchangeMappers } from './registry.ts'

export const paxosMappers = exchangeMappers({
  paxos: {
    trades: () => new PaxosTradesMapper(),
    bookChanges: () => new PaxosBookChangeMapper(),
    bookTickers: () => new PaxosBookTickerMapper()
  }
})

class PaxosTradesMapper implements Mapper<'paxos', Trade> {
  canHandle(message: any): message is PaxosTrade {
    return 'executed_at' in message && 'match_number' in message
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'executiondata' as const, symbols: upperCaseSymbols(symbols) }]
  }

  *map(message: PaxosTrade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: message.market,
      exchange: 'paxos',
      id: message.match_number,
      price: Number(message.price),
      amount: Number(message.amount),
      side: 'unknown',
      timestamp: new Date(message.executed_at),
      localTimestamp
    }
  }
}

class PaxosBookChangeMapper implements Mapper<'paxos', BookChange> {
  canHandle(message: any): message is PaxosBookSnapshot | PaxosBookUpdate {
    return message.type === 'SNAPSHOT' || message.type === 'UPDATE'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'marketdata' as const, symbols: upperCaseSymbols(symbols) }]
  }

  *map(message: PaxosBookSnapshot | PaxosBookUpdate, localTimestamp: Date): IterableIterator<BookChange> {
    if (message.type === 'SNAPSHOT') {
      yield {
        type: 'book_change',
        symbol: message.market,
        exchange: 'paxos',
        isSnapshot: true,
        bids: message.bids.map(this.mapBookLevel),
        asks: message.asks.map(this.mapBookLevel),
        timestamp: localTimestamp,
        localTimestamp
      }
      return
    }

    const level = this.mapBookLevel(message)
    yield {
      type: 'book_change',
      symbol: message.market,
      exchange: 'paxos',
      isSnapshot: false,
      bids: message.side === 'BUY' ? [level] : [],
      asks: message.side === 'SELL' ? [level] : [],
      timestamp: localTimestamp,
      localTimestamp
    }
  }

  private mapBookLevel(level: PaxosBookLevel): BookPriceLevel {
    return {
      price: Number(level.price),
      amount: Number(level.amount)
    }
  }
}

class PaxosBookTickerMapper implements Mapper<'paxos', BookTicker> {
  canHandle(message: any): message is PaxosStablecoinTicker {
    return 'price' in message && 'timestamp' in message
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'marketdata/stablecoin' as const, symbols: upperCaseSymbols(symbols) }]
  }

  *map(message: PaxosStablecoinTicker, localTimestamp: Date): IterableIterator<BookTicker> {
    const price = Number(message.price)

    yield {
      type: 'book_ticker',
      symbol: message.market,
      exchange: 'paxos',
      askPrice: price,
      askAmount: undefined,
      bidPrice: price,
      bidAmount: undefined,
      timestamp: new Date(message.timestamp),
      localTimestamp
    }
  }
}

export type PaxosNativeMessage = PaxosTrade | PaxosBookSnapshot | PaxosBookUpdate | PaxosStablecoinTicker | PaxosError

/** @see https://docs.paxos.com/api-reference/websockets/execution-data */
type PaxosTrade = {
  market: string
  price: string
  amount: string
  executed_at: string
  match_number: string
}

/** @see https://docs.paxos.com/api-reference/websockets/market-data */
type PaxosBookSnapshot = {
  type: 'SNAPSHOT'
  market: string
  bids: PaxosBookLevel[]
  asks: PaxosBookLevel[]
  final_snapshot?: boolean
}

/** @see https://docs.paxos.com/api-reference/websockets/market-data */
type PaxosBookUpdate = PaxosBookLevel & {
  type: 'UPDATE'
  market: string
  side: 'BUY' | 'SELL'
}
type PaxosBookLevel = {
  price: string
  amount: string
}

/** @see https://docs.paxos.com/api-reference/websockets/market-data-stablecoin */
type PaxosStablecoinTicker = {
  market: string
  price: string
  timestamp: string
}

type PaxosError = {
  error: string
}
