import { addMinutes, upperCaseSymbols } from '../handy'
import { BookChange, BookPriceLevel, BookTicker, DerivativeTicker, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

export const coinbaseInternationalTradesMapper: Mapper<'coinbase-international', Trade> = {
  canHandle(message: CoinbaseInternationalTradeMessage) {
    return message.channel === 'MATCH' && message.type === 'UPDATE'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'MATCH',
        symbols
      }
    ]
  },

  *map(message: CoinbaseInternationalTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: message.product_id,
      exchange: 'coinbase-international',
      id: message.match_id,
      price: Number(message.trade_price),
      amount: Number(message.trade_qty),
      side: message.aggressor_side === 'SELL' ? 'sell' : message.aggressor_side === 'BUY' ? 'buy' : 'unknown',
      timestamp: new Date(message.time),
      localTimestamp: localTimestamp
    }
  }
}

const mapUpdateBookLevel = (level: CoinbaseInternationalUpdateBookLevel) => {
  const price = Number(level[1])
  const amount = Number(level[2])

  return { price, amount }
}

const mapSnapshotBookLevel = (level: CoinbaseInternationalSnapshotBookLevel) => {
  const price = Number(level[0])
  const amount = Number(level[1])

  return { price, amount }
}

const validAmountsOnly = (level: BookPriceLevel) => {
  if (Number.isNaN(level.amount)) {
    return false
  }
  if (level.amount < 0) {
    return false
  }

  return true
}

export class CoinbaseInternationalBookChangMapper implements Mapper<'coinbase-international', BookChange> {
  canHandle(message: CoinbaseInternationalLevel2Snapshot | CoinbaseInternationalLevel2Update) {
    return message.channel === 'LEVEL2' && (message.type === 'SNAPSHOT' || message.type === 'UPDATE')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'LEVEL2',
        symbols
      } as const
    ]
  }

  *map(
    message: CoinbaseInternationalLevel2Snapshot | CoinbaseInternationalLevel2Update,
    localTimestamp: Date
  ): IterableIterator<BookChange> {
    if (message.type === 'SNAPSHOT') {
      let timestamp
      if (message.time !== undefined) {
        timestamp = new Date(message.time)
        if (timestamp.valueOf() < 0) {
          timestamp = localTimestamp
        }
      } else {
        timestamp = localTimestamp
      }

      yield {
        type: 'book_change',
        symbol: message.product_id,
        exchange: 'coinbase-international',
        isSnapshot: true,
        bids: message.bids.map(mapSnapshotBookLevel).filter(validAmountsOnly),
        asks: message.asks.map(mapSnapshotBookLevel).filter(validAmountsOnly),
        timestamp,
        localTimestamp
      }
    } else {
      let timestamp = new Date(message.time)

      yield {
        type: 'book_change',
        symbol: message.product_id,
        exchange: 'coinbase-international',
        isSnapshot: false,
        bids: message.changes.filter((c) => c[0] === 'BUY').map(mapUpdateBookLevel),
        asks: message.changes.filter((c) => c[0] === 'SELL').map(mapUpdateBookLevel),
        timestamp,
        localTimestamp: localTimestamp
      }
    }
  }
}

export const coinbaseInternationalBookTickerMapper: Mapper<'coinbase-international', BookTicker> = {
  canHandle(message: CoinbaseInternationalLevel1Message) {
    return message.channel === 'LEVEL1' && (message.type === 'SNAPSHOT' || message.type === 'UPDATE')
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'LEVEL1',
        symbols
      }
    ]
  },

  *map(message: CoinbaseInternationalLevel1Message, localTimestamp: Date): IterableIterator<BookTicker> {
    let timestamp = new Date(message.time)

    if (message.time === undefined || timestamp.valueOf() < 0) {
      timestamp = localTimestamp
    }

    yield {
      type: 'book_ticker',
      symbol: message.product_id,
      exchange: 'coinbase-international',
      askAmount: message.ask_qty !== undefined ? Number(message.ask_qty) : undefined,
      askPrice: message.ask_price !== undefined ? Number(message.ask_price) : undefined,
      bidPrice: message.bid_price !== undefined ? Number(message.bid_price) : undefined,
      bidAmount: message.bid_qty !== undefined ? Number(message.bid_qty) : undefined,
      timestamp,
      localTimestamp: localTimestamp
    }
  }
}

export class CoinbaseInternationalDerivativeTickerMapper implements Mapper<'coinbase-international', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: CoinbaseInternationalTradeMessage | CoinbaseInternationalRiskMessage | CoinbaseInternationalFundingMessage) {
    // perps only
    if (message.product_id === undefined || message.product_id.endsWith('-PERP') === false) {
      return false
    }

    if (message.channel === 'MATCH' && message.type === 'UPDATE') {
      return true
    }

    if (message.channel === 'FUNDING' && message.type === 'UPDATE') {
      return true
    }

    if (message.channel === 'RISK') {
      return true
    }

    return false
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'MATCH',
        symbols
      } as const,
      {
        channel: 'RISK',
        symbols
      } as const,
      {
        channel: 'FUNDING',
        symbols
      } as const
    ]
  }

  *map(
    message: CoinbaseInternationalTradeMessage | CoinbaseInternationalRiskMessage | CoinbaseInternationalFundingMessage,
    localTimestamp: Date
  ): IterableIterator<DerivativeTicker> {
    if (message.channel === 'MATCH') {
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.product_id, 'coinbase-international')
      pendingTickerInfo.updateLastPrice(Number(message.trade_price))

      return
    }
    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.product_id, 'coinbase-international')

    if (message.channel === 'RISK') {
      if (message.index_price !== undefined) {
        pendingTickerInfo.updateIndexPrice(Number(message.index_price))
      }
      if (message.mark_price !== undefined) {
        pendingTickerInfo.updateMarkPrice(Number(message.mark_price))
      }
      if (message.open_interest !== undefined) {
        pendingTickerInfo.updateOpenInterest(Number(message.open_interest))
      }
    }

    if (message.channel === 'FUNDING') {
      let nextFundingTime = new Date(message.time)
      if (message.is_final === false) {
        // If the field is_final is false, the message indicates the predicted funding rate for the next funding interval.
        // https://docs.cdp.coinbase.com/intx/docs/websocket-channels#funding-channel
        nextFundingTime.setUTCMinutes(0, 0, 0)
        nextFundingTime = addMinutes(nextFundingTime, 60)

        pendingTickerInfo.updateFundingTimestamp(nextFundingTime)
      }

      pendingTickerInfo.updateFundingRate(Number(message.funding_rate))
    }

    pendingTickerInfo.updateTimestamp(new Date(message.time))

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

// TODO: real-time

type CoinbaseInternationalTradeMessage = {
  sequence: 80
  match_id: '374491377330814981'
  trade_price: '0.009573'
  trade_qty: '1651'
  aggressor_side: 'BUY' | 'SELL' | 'OPENING_FILL'
  channel: 'MATCH'
  type: 'UPDATE'
  time: '2024-10-30T10:55:02.069Z'
  product_id: 'MEW-PERP'
}

type CoinbaseInternationalSnapshotBookLevel = [string, string]

type CoinbaseInternationalLevel2Snapshot = {
  sequence: 81053126
  bids: CoinbaseInternationalSnapshotBookLevel[]
  asks: CoinbaseInternationalSnapshotBookLevel[]
  channel: 'LEVEL2'
  type: 'SNAPSHOT'
  time: '2024-11-06T23:59:59.812Z'
  product_id: 'BB-PERP'
}

type CoinbaseInternationalUpdateBookLevel = ['BUY' | 'SELL', string, string]

type CoinbaseInternationalLevel2Update = {
  sequence: 162
  changes: CoinbaseInternationalUpdateBookLevel[]
  channel: 'LEVEL2'
  type: 'UPDATE'
  time: '2024-10-30T10:55:02.348Z'
  product_id: 'NOT-PERP'
}

type CoinbaseInternationalLevel1Message =
  | {
      sequence: 65960075
      bid_price: '27.03'
      bid_qty: '24.404'
      ask_price: '27.037'
      ask_qty: '32.302'
      channel: 'LEVEL1'
      type: 'SNAPSHOT'
      time: '2024-11-07T00:00:00.121Z'
      product_id: 'AVAX-PERP'
    }
  | {
      sequence: 120100774
      bid_price: '2719.96'
      bid_qty: '0.3676'
      ask_price: '2720.25'
      ask_qty: '0.919'
      channel: 'LEVEL1'
      type: 'UPDATE'
      time: '2024-11-07T00:00:59.979Z'
      product_id: 'ETH-USDC'
    }

type CoinbaseInternationalRiskMessage = {
  sequence: 108523490
  limit_up: '0.5107'
  limit_down: '0.4621'
  index_price: '0.4864755122500001'
  mark_price: '0.4863'
  settlement_price: '0.4864'
  open_interest: '153090'
  channel: 'RISK'
  type: 'UPDATE'
  time: '2024-11-07T00:00:59.950Z'
  product_id: 'ENA-PERP'
}

type CoinbaseInternationalFundingMessage = {
  sequence: 108521023
  funding_rate: '0.000009'
  is_final: false
  channel: 'FUNDING'
  type: 'UPDATE'
  time: '2024-11-07T00:00:51.068Z'
  product_id: 'DEGEN-PERP'
}
