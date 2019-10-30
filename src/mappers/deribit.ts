import { BookChange, DerivativeTicker, Trade } from '../types'
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

    return channel.startsWith('ticker')
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

    pendingTickerInfo.updateFundingRate(deribitTicker.funding_8h)
    pendingTickerInfo.updateIndexPrice(deribitTicker.index_price)
    pendingTickerInfo.updateMarkPrice(deribitTicker.mark_price)
    pendingTickerInfo.updateOpenInterest(deribitTicker.open_interest)
    pendingTickerInfo.updateLastPrice(deribitTicker.last_price)

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(new Date(deribitTicker.timestamp), localTimestamp)
    }
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
      last_price: number
      mark_price: number
      instrument_name: string
      index_price: number
      current_funding?: number
      funding_8h?: number
    }
  }
}
