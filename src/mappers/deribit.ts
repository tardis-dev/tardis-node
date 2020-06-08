import { BookChange, DerivativeTicker, Trade, OptionSummary } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://docs.deribit.com/v2/#subscriptions

export const deribitTradesMapper: Mapper<'deribit', Trade> = {
  canHandle(message: any) {
    const channel = message.params !== undefined ? (message.params.channel as string | undefined) : undefined
    if (channel === undefined) {
      return false
    }

    return channel.startsWith('trades')
  },

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'trades',
        symbols
      }
    ]
  },

  *map(message: DeribitTradesMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const deribitTrade of message.params.data) {
      yield {
        type: 'trade',
        symbol: deribitTrade.instrument_name,
        exchange: 'deribit',
        id: deribitTrade.trade_id,
        price: deribitTrade.price,
        amount: deribitTrade.amount,
        side: deribitTrade.direction,
        timestamp: new Date(deribitTrade.timestamp),
        localTimestamp: localTimestamp
      }
    }
  }
}

const mapBookLevel = (level: DeribitBookLevel) => {
  const price = level[1]
  const amount = level[0] === 'delete' ? 0 : level[2]

  return { price, amount }
}

export const deribitBookChangeMapper: Mapper<'deribit', BookChange> = {
  canHandle(message: any) {
    const channel = message.params && (message.params.channel as string | undefined)
    if (channel === undefined) {
      return false
    }

    return channel.startsWith('book')
  },

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'book',
        symbols
      }
    ]
  },

  *map(message: DeribitBookMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const deribitBookChange = message.params.data
    // snapshots do not have prev_change_id set
    const isSnapshot = deribitBookChange.prev_change_id === undefined

    yield {
      type: 'book_change',
      symbol: deribitBookChange.instrument_name,
      exchange: 'deribit',
      isSnapshot,
      bids: deribitBookChange.bids.map(mapBookLevel),
      asks: deribitBookChange.asks.map(mapBookLevel),
      timestamp: new Date(deribitBookChange.timestamp),
      localTimestamp: localTimestamp
    }
  }
}

export class DeribitDerivativeTickerMapper implements Mapper<'deribit', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: any) {
    const channel = message.params && (message.params.channel as string | undefined)
    if (channel === undefined) {
      return false
    }

    // exclude options tickers
    return channel.startsWith('ticker') && message.params.data.greeks === undefined
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'ticker',
        symbols
      } as const
    ]
  }

  *map(message: DeribitTickerMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const deribitTicker = message.params.data
    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(deribitTicker.instrument_name, 'deribit')

    pendingTickerInfo.updateFundingRate(deribitTicker.current_funding)
    pendingTickerInfo.updateIndexPrice(deribitTicker.index_price)
    pendingTickerInfo.updateMarkPrice(deribitTicker.mark_price)
    pendingTickerInfo.updateOpenInterest(deribitTicker.open_interest)
    pendingTickerInfo.updateLastPrice(deribitTicker.last_price)
    pendingTickerInfo.updateTimestamp(new Date(deribitTicker.timestamp))

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

export class DeribitOptionSummaryMapper implements Mapper<'deribit', OptionSummary> {
  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'ticker',
        symbols
      } as const
    ]
  }

  canHandle(message: any) {
    const channel = message.params && message.params.channel
    if (channel === undefined) {
      return false
    }

    // options ticker has greeks
    return channel.startsWith('ticker') && message.params.data.greeks !== undefined
  }

  *map(message: DeribitOptionTickerMessage, localTimestamp: Date) {
    const optionInfo = message.params.data

    //e.g., BTC-8JUN20-8750-P
    const symbolParts = optionInfo.instrument_name.split('-')

    const isPut = symbolParts[3] === 'P'

    const strikePrice = Number(symbolParts[2])
    const expirationDate = new Date(symbolParts[1] + 'Z')
    expirationDate.setUTCHours(8)

    const optionSummary: OptionSummary = {
      type: 'option_summary',
      symbol: optionInfo.instrument_name,
      exchange: 'deribit',
      optionType: isPut ? 'put' : 'call',
      strikePrice,
      expirationDate,

      bestBidPrice: optionInfo.best_bid_price === 0 ? undefined : optionInfo.best_bid_price,
      bestBidAmount: optionInfo.best_bid_amount === 0 ? undefined : optionInfo.best_bid_amount,
      bestBidIV: optionInfo.bid_iv === 0 ? undefined : optionInfo.bid_iv,

      bestAskPrice: optionInfo.best_ask_price === 0 ? undefined : optionInfo.best_ask_price,
      bestAskAmount: optionInfo.best_ask_amount === 0 ? undefined : optionInfo.best_ask_amount,
      bestAskIV: optionInfo.ask_iv === 0 ? undefined : optionInfo.ask_iv,

      lastPrice: optionInfo.last_price !== null ? optionInfo.last_price : undefined,
      openInterest: optionInfo.open_interest,

      markPrice: optionInfo.mark_price,
      markIV: optionInfo.mark_iv,

      delta: optionInfo.greeks.delta,
      gamma: optionInfo.greeks.gamma,
      vega: optionInfo.greeks.vega,
      theta: optionInfo.greeks.theta,
      rho: optionInfo.greeks.rho,

      underlyingPrice: optionInfo.underlying_price,
      underlyingIndex: optionInfo.underlying_index,

      timestamp: new Date(optionInfo.timestamp),
      localTimestamp: localTimestamp
    }

    yield optionSummary
  }
}

type DeribitMessage = {
  params: {
    channel: string
  }
}

type DeribitTradesMessage = DeribitMessage & {
  params: {
    data: {
      trade_id: string
      instrument_name: string
      timestamp: number
      direction: 'buy' | 'sell'
      price: number
      amount: number
      trade_seq: number
    }[]
  }
}

type DeribitBookLevel = ['new' | 'change' | 'delete', number, number]

type DeribitBookMessage = DeribitMessage & {
  params: {
    data: {
      timestamp: number
      instrument_name: string
      prev_change_id?: number
      bids: DeribitBookLevel[]
      asks: DeribitBookLevel[]
    }
  }
}

type DeribitTickerMessage = DeribitMessage & {
  params: {
    data: {
      timestamp: number
      open_interest: number
      last_price: number | null
      mark_price: number
      instrument_name: string
      index_price: number
      current_funding?: number
      funding_8h?: number
    }
  }
}

type DeribitOptionTickerMessage = DeribitMessage & {
  params: {
    data: {
      underlying_price: number
      underlying_index: string
      timestamp: number
      open_interest: number
      mark_price: number
      mark_iv: number
      last_price: number | null

      instrument_name: string
      greeks: { vega: number; theta: number; rho: number; gamma: number; delta: number }

      bid_iv: number | undefined
      best_bid_price: number | undefined
      best_bid_amount: number | undefined
      best_ask_price: number | undefined
      best_ask_amount: number | undefined
      ask_iv: number | undefined
    }
  }
}
