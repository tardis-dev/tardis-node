import { parseμs, upperCaseSymbols } from '../handy'
import { BookChange, Trade } from '../types'
import { Mapper } from './mapper'

export const bitnomialTradesMapper: Mapper<'bitnomial', Trade> = {
  canHandle(message: BitnomialTrade) {
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

  *map(message: BitnomialTrade, localTimestamp: Date): IterableIterator<Trade> {
    const timestamp = new Date(message.timestamp)
    timestamp.μs = parseμs(message.timestamp)

    yield {
      type: 'trade',
      symbol: message.symbol,
      exchange: 'bitnomial',
      id: String(message.ack_id),
      price: Number(message.price),
      amount: Number(message.quantity),
      side: message.taker_side === 'Bid' ? 'buy' : 'sell',
      timestamp,
      localTimestamp: localTimestamp
    }
  }
}

const mapBookLevel = (level: BookLevel) => {
  return { price: level[0], amount: level[1] }
}

export class BitnomialBookChangMapper implements Mapper<'bitnomial', BookChange> {
  canHandle(message: BitnomialBookMessage) {
    return message.type === 'book' || message.type === 'level'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'book',
        symbols
      } as const,
      {
        channel: 'level',
        symbols
      } as const
    ]
  }

  *map(message: BitnomialBookMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const timestamp = new Date(message.timestamp)
    timestamp.μs = parseμs(message.timestamp)

    if (message.type === 'book') {
      yield {
        type: 'book_change',
        symbol: message.symbol,
        exchange: 'bitnomial',
        isSnapshot: true,
        bids: message.bids.map(mapBookLevel),
        asks: message.asks.map(mapBookLevel),
        timestamp,
        localTimestamp
      }
    } else {
      const update = {
        price: message.price,
        amount: message.quantity
      }
      yield {
        type: 'book_change',
        symbol: message.symbol,
        exchange: 'bitnomial',
        isSnapshot: false,
        bids: message.side === 'Bid' ? [update] : [],
        asks: message.side === 'Ask' ? [update] : [],
        timestamp,
        localTimestamp: localTimestamp
      }
    }
  }
}

type BitnomialTrade = {
  type: 'trade'
  ack_id: '7148460953766461527'
  price: 19000
  quantity: 10
  symbol: 'BUSZ2'
  taker_side: 'Bid'
  timestamp: '2022-09-28T16:06:39.022836179Z'
}

type BookLevel = [number, number]

type BitnomialBookMessage =
  | {
      ack_id: '7187577067767395971'
      price: 18970
      quantity: 5
      side: 'Ask' | 'Bid'
      symbol: 'BUIH23'
      timestamp: '2023-01-12T20:03:28.292532617Z'
      type: 'level'
    }
  | {
      ack_id: '7187577067767395784'
      asks: BookLevel[]
      bids: BookLevel[]
      symbol: 'BUSH23'
      timestamp: '2023-01-12T20:03:06.479197763Z'
      type: 'book'
    }
