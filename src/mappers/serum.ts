import { Mapper } from './mapper'
import { Trade, BookChange } from '../types'

export class SerumTradesMapper implements Mapper<'serum', Trade> {
  canHandle(message: SerumVialTrade) {
    return message.type === 'trade'
  }

  getFilters(symbols?: string[]) {
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
      symbol: message.market,
      exchange: 'serum',
      id: message.id,
      price: Number(message.price),
      amount: Number(message.size),
      side: message.side,
      timestamp: new Date(message.timestamp),
      localTimestamp: localTimestamp
    }
  }
}

export class SerumBookChangeMapper implements Mapper<'serum', BookChange> {
  canHandle(message: SerumVialL2Snapshot | SerumVialL2Update) {
    return message.type === 'l2snapshot' || message.type === 'l2update'
  }

  getFilters(symbols?: string[]) {
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
      symbol: message.market,
      exchange: 'serum',
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
