import { upperCaseSymbols } from '../handy'
import { BookChange, DerivativeTicker, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

const fromMicroSecondsToDate = (micros: number) => {
  const timestamp = new Date(micros / 1000)
  timestamp.μs = micros % 1000

  return timestamp
}

export class DeltaTradesMapper implements Mapper<'delta', Trade> {
  constructor(private _useV2Channels: boolean) {}

  canHandle(message: DeltaTrade) {
    return message.type === (this._useV2Channels ? 'all_trades' : 'recent_trade')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: this._useV2Channels ? 'all_trades' : 'recent_trade',
        symbols
      } as const
    ]
  }

  *map(message: DeltaTrade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: message.symbol,
      exchange: 'delta',
      id: undefined,
      price: Number(message.price),
      amount: Number(message.size),
      side: message.buyer_role === 'taker' ? 'buy' : 'sell',
      timestamp: fromMicroSecondsToDate(message.timestamp),
      localTimestamp: localTimestamp
    }
  }
}

const mapBookLevel = (level: DeltaBookLevel) => {
  return {
    price: Number(level.limit_price),
    amount: Number(level.size)
  }
}

export const deltaBookChangeMapper: Mapper<'delta', BookChange> = {
  canHandle(message: DeltaL2OrderBook) {
    return message.type === 'l2_orderbook'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

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
      timestamp: message.timestamp !== undefined ? fromMicroSecondsToDate(message.timestamp) : localTimestamp,
      localTimestamp
    }
  }
}

export class DeltaDerivativeTickerMapper implements Mapper<'delta', DerivativeTicker> {
  constructor(private _useV2Channels: boolean) {}

  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: DeltaTrade | DeltaMarkPrice | DeltaFundingRate) {
    return (
      message.type === (this._useV2Channels ? 'all_trades' : 'recent_trade') ||
      message.type === 'funding_rate' ||
      message.type === 'mark_price'
    )
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: this._useV2Channels ? 'all_trades' : 'recent_trade',
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

    if (message.type === 'recent_trade' || message.type === 'all_trades') {
      pendingTickerInfo.updateLastPrice(Number(message.price))
    }
    if (message.type === 'mark_price') {
      pendingTickerInfo.updateMarkPrice(Number(message.price))
    }

    if (message.type === 'funding_rate') {
      if (message.funding_rate !== undefined) {
        pendingTickerInfo.updateFundingRate(Number(message.funding_rate))
      }

      if (message.predicted_funding_rate !== undefined) {
        pendingTickerInfo.updatePredictedFundingRate(Number(message.predicted_funding_rate))
      }

      if (message.next_funding_realization !== undefined) {
        pendingTickerInfo.updateFundingTimestamp(fromMicroSecondsToDate(message.next_funding_realization))
      }
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
  size: number | string
  symbol: string
  timestamp: number
  type: 'recent_trade' | 'all_trades'
}

type DeltaBookLevel = {
  limit_price: string
  size: number | string
}

type DeltaL2OrderBook = {
  buy: DeltaBookLevel[]
  sell: DeltaBookLevel[]
  symbol: string
  timestamp?: number
  type: 'l2_orderbook'
}

type DeltaMarkPrice = {
  price: string
  symbol: string
  timestamp: number
  type: 'mark_price'
}

type DeltaFundingRate = {
  funding_rate?: string | number
  next_funding_realization?: number
  predicted_funding_rate?: number
  symbol: string
  timestamp: number
  type: 'funding_rate'
}
