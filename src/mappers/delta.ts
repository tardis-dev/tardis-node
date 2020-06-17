import { Mapper, PendingTickerInfoHelper } from './mapper'
import { Trade, BookChange, DerivativeTicker } from '../types'

const fromMicroSecondsToDate = (micros: number) => {
  const timestamp = new Date(micros / 1000)
  timestamp.μs = micros % 1000

  return timestamp
}

export const deltaTradesMapper: Mapper<'delta', Trade> = {
  canHandle(message: DeltaTrade) {
    return message.type === 'recent_trade'
  },

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'recent_trade',
        symbols
      } as const
    ]
  },

  *map(message: DeltaTrade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: message.symbol,
      exchange: 'delta',
      id: undefined,
      price: Number(message.price),
      amount: message.size,
      side: message.buyer_role === 'taker' ? 'buy' : 'sell',
      timestamp: fromMicroSecondsToDate(message.timestamp),
      localTimestamp: localTimestamp
    }
  }
}

const mapBookLevel = (level: DeltaBookLevel) => {
  return {
    price: Number(level.limit_price),
    amount: level.size
  }
}

export const deltaBookChangeMapper: Mapper<'delta', BookChange> = {
  canHandle(message: DeltaL2OrderBook) {
    return message.type === 'l2_orderbook'
  },

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'l2_orderbook',
        symbols
      } as const
    ]
  },

  *map(message: DeltaL2OrderBook, localTimestamp: Date): IterableIterator<BookChange> {
    yield {
      type: 'book_change',
      symbol: message.symbol,
      exchange: 'delta',
      isSnapshot: true,
      bids: message.buy.map(mapBookLevel),
      asks: message.sell.map(mapBookLevel),
      timestamp: fromMicroSecondsToDate(message.timestamp),
      localTimestamp
    }
  }
}

export class DeltaDerivativeTickerMapper implements Mapper<'delta', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: DeltaTrade | DeltaMarkPrice | DeltaFundingRate) {
    return message.type === 'recent_trade' || message.type === 'funding_rate' || message.type === 'mark_price'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'recent_trade',
        symbols
      } as const,
      {
        channel: 'funding_rate',
        symbols
      } as const,
      {
        channel: 'mark_price',
        symbols
      } as const
    ]
  }

  *map(message: DeltaTrade | DeltaMarkPrice | DeltaFundingRate, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.symbol.replace('MARK:', ''), 'delta')

    if (message.type === 'recent_trade') {
      pendingTickerInfo.updateLastPrice(Number(message.price))
    }
    if (message.type === 'mark_price') {
      pendingTickerInfo.updateMarkPrice(Number(message.price))
    }
    if (message.type === 'funding_rate') {
      pendingTickerInfo.updateFundingRate(Number(message.funding_rate))
    }

    pendingTickerInfo.updateTimestamp(fromMicroSecondsToDate(message.timestamp))

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

type DeltaTrade = {
  buyer_role: 'taker' | 'maker'
  price: string
  size: number
  symbol: string
  timestamp: number
  type: 'recent_trade'
}

type DeltaBookLevel = {
  limit_price: string
  size: number
}

type DeltaL2OrderBook = {
  buy: DeltaBookLevel[]
  sell: DeltaBookLevel[]
  symbol: string
  timestamp: number
  type: 'l2_orderbook'
}

type DeltaMarkPrice = {
  price: string
  symbol: string
  timestamp: number
  type: 'mark_price'
}

type DeltaFundingRate = {
  funding_rate: string
  symbol: string
  timestamp: number
  type: 'funding_rate'
}
