import { Mapper, DataType, Trade, Ticker, Quote, BookChange } from './mapper'
import { FilterForExchange } from '../consts'

export class DeribitMapper extends Mapper<'deribit'> {
  getDataType(message: any): DataType | undefined {
    const channel = message.params && (message.params.channel as string | undefined)

    if (!channel) {
      return
    }

    if (channel.startsWith('trades')) {
      return 'trades'
    }

    if (channel.startsWith('book')) {
      return 'bookChange'
    }

    if (channel.startsWith('ticker')) {
      return 'ticker'
    }

    if (channel.startsWith('quote')) {
      return 'quote'
    }

    return
  }

  getFilterForDataType(dataType: DataType) {
    const channel: FilterForExchange['deribit']['channel'] = dataType == 'bookChange' ? 'book' : dataType
    return {
      channel,
      symbols: this._symbols
    }
  }

  *mapTrades(localTimestamp: Date, message: DeribitTradeMessage): IterableIterator<Trade> {
    for (const deribitTrade of message.params.data) {
      yield {
        id: deribitTrade.trade_id,
        symbol: deribitTrade.instrument_name,
        price: deribitTrade.price,
        amount: deribitTrade.amount,
        side: deribitTrade.direction,
        timestamp: new Date(deribitTrade.timestamp),
        localTimestamp
      }
    }
  }

  mapTicker(localTimestamp: Date, message: DeribitTickerMessage): Ticker {
    const deribitTicker = message.params.data

    return {
      symbol: deribitTicker.instrument_name,
      bestBidPrice: deribitTicker.best_bid_price,
      bestAskPrice: deribitTicker.best_ask_price,
      lastPrice: deribitTicker.last_price,
      volume: deribitTicker.stats.volume,

      openInterest: deribitTicker.open_interest,
      fundingRate: deribitTicker.current_funding,
      indexPrice: deribitTicker.index_price,
      markPrice: deribitTicker.mark_price,
      timestamp: new Date(deribitTicker.timestamp),
      localTimestamp
    }
  }

  mapQuote(localTimestamp: Date, message: DeribitQuoteMessage): Quote {
    const deribitQuote = message.params.data

    return {
      symbol: deribitQuote.instrument_name,
      bestBidPrice: deribitQuote.best_bid_price,
      bestBidAmount: deribitQuote.best_bid_amount,
      bestAskPrice: deribitQuote.best_ask_price,
      bestAskAmount: deribitQuote.best_ask_amount,
      timestamp: new Date(deribitQuote.timestamp),
      localTimestamp
    }
  }

  mapBookChange(localTimestamp: Date, message: DeribitBookMessage): BookChange {
    const deribitBookChange = message.params.data

    return {
      symbol: deribitBookChange.instrument_name,
      bids: deribitBookChange.bids.map(this._mapBookLevel),
      asks: deribitBookChange.asks.map(this._mapBookLevel),
      timestamp: new Date(deribitBookChange.timestamp),
      localTimestamp
    }
  }

  private _mapBookLevel(level: BookLevel): [number, number] {
    const price = level[1]
    const amount = level[0] == 'delete' ? 0 : level[2]

    return [price, amount]
  }
}

type DeribitMessage = {
  params: {
    channel: string
  }
}

type DeribitQuoteMessage = DeribitMessage & {
  params: {
    data: {
      timestamp: number
      instrument_name: string
      best_bid_price: number
      best_bid_amount: number
      best_ask_price: number
      best_ask_amount: number
    }
  }
}

type DeribitTradeMessage = DeribitMessage & {
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

type BookLevel = ['new' | 'change' | 'delete', number, number]

type DeribitBookMessage = DeribitMessage & {
  params: {
    data: {
      timestamp: number
      instrument_name: string
      bids: BookLevel[]
      asks: BookLevel[]
    }
  }
}

type DeribitTickerMessage = DeribitMessage & {
  params: {
    data: {
      timestamp: number
      stats: {
        volume: number
        low: number
        high: number
      }

      open_interest: number

      mark_price: number
      last_price: number
      instrument_name: string
      index_price: number
      current_funding?: number
      best_bid_price: number
      best_ask_price: number
    }
  }
}
