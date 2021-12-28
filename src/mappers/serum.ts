import { asNumberIfValid, upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, Exchange, Trade } from '../types'
import { Mapper } from './mapper'

export class SerumTradesMapper implements Mapper<'serum' | 'star-atlas', Trade> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: SerumVialTrade) {
    return message.type === 'trade'
  }

  getFilters(symbols?: string[]) {
    if (this._exchange === 'serum') {
      symbols = upperCaseSymbols(symbols)
    }

    return [
      {
        channel: 'trade',
        symbols
      } as const
    ]
  }

  *map(message: SerumVialTrade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: message.market.toUpperCase(),
      exchange: this._exchange,
      id: message.id,
      price: Number(message.price),
      amount: Number(message.size),
      side: message.side,
      timestamp: new Date(message.timestamp),
      localTimestamp: localTimestamp
    }
  }
}

export class SerumBookChangeMapper implements Mapper<'serum' | 'star-atlas', BookChange> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: SerumVialL2Snapshot | SerumVialL2Update) {
    return message.type === 'l2snapshot' || message.type === 'l2update'
  }

  getFilters(symbols?: string[]) {
    if (this._exchange === 'serum') {
      symbols = upperCaseSymbols(symbols)
    }

    return [
      {
        channel: 'l2snapshot',
        symbols
      } as const,
      {
        channel: 'l2update',
        symbols
      } as const
    ]
  }

  *map(message: SerumVialL2Snapshot | SerumVialL2Update, localTimestamp: Date): IterableIterator<BookChange> {
    yield {
      type: 'book_change',
      symbol: message.market.toUpperCase(),
      exchange: this._exchange,
      isSnapshot: message.type === 'l2snapshot',
      bids: message.bids.map(this.mapBookLevel),
      asks: message.asks.map(this.mapBookLevel),
      timestamp: new Date(message.timestamp),
      localTimestamp
    }
  }

  protected mapBookLevel(level: SerumVialPriceLevel) {
    const price = Number(level[0])
    const amount = Number(level[1])
    return { price, amount }
  }
}

export class SerumBookTickerMapper implements Mapper<'serum' | 'star-atlas', BookTicker> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: SerumVialQuote) {
    return message.type === 'quote'
  }

  getFilters(symbols?: string[]) {
    if (this._exchange === 'serum') {
      symbols = upperCaseSymbols(symbols)
    }

    return [
      {
        channel: 'quote',
        symbols
      } as const
    ]
  }

  *map(message: SerumVialQuote, localTimestamp: Date): IterableIterator<BookTicker> {
    yield {
      type: 'book_ticker',
      symbol: message.market.toUpperCase(),
      exchange: this._exchange,

      askAmount: message.bestAsk !== undefined ? asNumberIfValid(message.bestAsk[1]) : undefined,
      askPrice: message.bestAsk !== undefined ? asNumberIfValid(message.bestAsk[0]) : undefined,

      bidPrice: message.bestBid !== undefined ? asNumberIfValid(message.bestBid[0]) : undefined,
      bidAmount: message.bestBid !== undefined ? asNumberIfValid(message.bestBid[1]) : undefined,
      timestamp: new Date(message.timestamp),
      localTimestamp: localTimestamp
    }
  }
}

type SerumVialTrade = {
  type: 'trade'
  market: 'RAY/USDT'
  timestamp: '2021-05-22T00:00:59.448Z'
  slot: 79469377
  version: 3
  id: '96845406386975144808722|185.8|1621641659448'
  side: 'buy'
  price: '5.235'
  size: '185.8'
}

type SerumVialPriceLevel = [string, string]

type SerumVialL2Snapshot = {
  type: 'l2snapshot'
  market: 'RAY/USDT'
  timestamp: '2021-05-21T23:58:56.899Z'
  slot: 79469186
  version: 3
  asks: SerumVialPriceLevel[]
  bids: SerumVialPriceLevel[]
}

type SerumVialL2Update = {
  type: 'l2update'
  market: 'RAY/USDT'
  timestamp: '2021-05-22T00:00:20.959Z'
  slot: 79469318
  version: 3
  asks: SerumVialPriceLevel[]
  bids: SerumVialPriceLevel[]
}

type SerumVialQuote = {
  type: 'quote'
  market: string
  timestamp: string
  slot: number
  version: number
  bestAsk: [price: string, size: string] | undefined
  bestBid: [price: string, size: string] | undefined
}
