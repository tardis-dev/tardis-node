import { fromMicroSecondsToDate, upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, DerivativeTicker, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

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

const mapL2Level = (level: DeltaL2Level) => {
  return {
    price: Number(level[0]),
    amount: Number(level[1])
  }
}

export class DeltaBookChangeMapper implements Mapper<'delta', BookChange> {
  constructor(private readonly _useL2UpdatesChannel: boolean) {}

  canHandle(message: DeltaL2OrderBook | DeltaL2UpdateMessage) {
    if (this._useL2UpdatesChannel) {
      return message.type === 'l2_updates'
    }
    return message.type === 'l2_orderbook'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    if (this._useL2UpdatesChannel) {
      return [
        {
          channel: 'l2_updates',
          symbols
        } as const
      ]
    }

    return [
      {
        channel: 'l2_orderbook',
        symbols
      } as const
    ]
  }

  *map(message: DeltaL2OrderBook | DeltaL2UpdateMessage, localTimestamp: Date): IterableIterator<BookChange> {
    if (message.type === 'l2_updates') {
      yield {
        type: 'book_change',
        symbol: message.symbol,
        exchange: 'delta',
        isSnapshot: message.action === 'snapshot',
        bids: message.bids !== undefined ? message.bids.map(mapL2Level) : [],
        asks: message.asks !== undefined ? message.asks.map(mapL2Level) : [],
        timestamp: message.timestamp !== undefined ? fromMicroSecondsToDate(message.timestamp) : localTimestamp,
        localTimestamp
      }
    } else {
      if (message.buy === undefined && message.sell === undefined) {
        return
      }
      yield {
        type: 'book_change',
        symbol: message.symbol,
        exchange: 'delta',
        isSnapshot: true,
        bids: message.buy !== undefined ? message.buy.map(mapBookLevel) : [],
        asks: message.sell !== undefined ? message.sell.map(mapBookLevel) : [],
        timestamp: message.timestamp !== undefined ? fromMicroSecondsToDate(message.timestamp) : localTimestamp,
        localTimestamp
      }
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

export class DeltaBookTickerMapper implements Mapper<'delta', BookTicker> {
  canHandle(message: DeltaL1Message) {
    return message.type === 'l1_orderbook'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'l1_orderbook',
        symbols
      } as const
    ]
  }

  *map(message: DeltaL1Message, localTimestamp: Date) {
    const ticker: BookTicker = {
      type: 'book_ticker',
      symbol: message.symbol,
      exchange: 'delta',
      askAmount: message.ask_qty !== undefined ? Number(message.ask_qty) : undefined,
      askPrice: message.best_ask !== undefined ? Number(message.best_ask) : undefined,
      bidPrice: message.best_bid !== undefined ? Number(message.best_bid) : undefined,
      bidAmount: message.bid_qty !== undefined ? Number(message.bid_qty) : undefined,
      timestamp: message.timestamp !== undefined ? fromMicroSecondsToDate(message.timestamp) : localTimestamp,
      localTimestamp: localTimestamp
    }

    yield ticker
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

type DeltaL2Level = [string, string]
type DeltaL2UpdateMessage =
  | {
      action: 'snapshot'
      asks: DeltaL2Level[]
      bids: DeltaL2Level[]
      cs: 220729409
      sequence_no: 3660223
      symbol: string
      timestamp: 1680307203021223
      type: 'l2_updates'
    }
  | {
      action: 'update'
      asks: DeltaL2Level[]
      bids: DeltaL2Level[]
      cs: 2728204214
      sequence_no: 3660224
      symbol: string
      timestamp: 1680307203771239
      type: 'l2_updates'
    }

type DeltaL1Message = {
  ask_qty: '1950'
  best_ask: '4964.5'
  best_bid: '4802'
  bid_qty: '4356'
  last_sequence_no: 1680307203966299
  last_updated_at: 1680307203784000
  product_id: 103877
  symbol: 'P-BTC-33000-210423'
  timestamp: 1680307203966299
  type: 'l1_orderbook'
}
