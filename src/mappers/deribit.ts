import { DataType, Quote, Ticker, Trade, L2Change, FilterForExchange } from '../types'
import { Mapper } from './mapper'

// https://docs.deribit.com/v2/#subscriptions

export class DeribitMapper extends Mapper {
  private readonly _dataTypeChannelMapping: { [key in DataType]: FilterForExchange['deribit']['channel'] } = {
    l2change: 'book',
    trade: 'trades',
    quote: 'quote',
    ticker: 'ticker'
  }

  public getFiltersForDataTypeAndSymbols(dataType: DataType, symbols?: string[]) {
    const channel = this._dataTypeChannelMapping[dataType]
    return [
      {
        channel,
        symbols
      }
    ]
  }

  protected detectDataType(message: any): DataType | undefined {
    const channel = message.params && (message.params.channel as string | undefined)

    if (!channel) {
      return
    }

    if (channel.startsWith('trades')) {
      return 'trade'
    }

    if (channel.startsWith('book')) {
      return 'l2change'
    }

    if (channel.startsWith('ticker')) {
      return 'ticker'
    }

    if (channel.startsWith('quote')) {
      return 'quote'
    }

    return
  }

  protected *mapTrades(message: DeribitTradesMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const deribitTrade of message.params.data) {
      yield {
        type: 'trade',
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

  protected *mapTickers(message: DeribitTickerMessage, localTimestamp: Date): IterableIterator<Ticker> {
    const deribitTicker = message.params.data

    yield {
      type: 'ticker',
      symbol: deribitTicker.instrument_name,
      bestBidPrice: deribitTicker.best_bid_price,
      bestAskPrice: deribitTicker.best_ask_price,
      lastPrice: deribitTicker.last_price,

      openInterest: deribitTicker.open_interest,
      fundingRate: deribitTicker.current_funding,
      indexPrice: deribitTicker.index_price,
      markPrice: deribitTicker.mark_price,
      timestamp: new Date(deribitTicker.timestamp),
      localTimestamp
    }
  }

  protected *mapQuotes(message: DeribitQuoteMessage, localTimestamp: Date): IterableIterator<Quote> {
    const deribitQuote = message.params.data

    yield {
      type: 'quote',
      symbol: deribitQuote.instrument_name,
      bestBidPrice: deribitQuote.best_bid_price,
      bestBidAmount: deribitQuote.best_bid_amount,
      bestAskPrice: deribitQuote.best_ask_price,
      bestAskAmount: deribitQuote.best_ask_amount,
      timestamp: new Date(deribitQuote.timestamp),
      localTimestamp
    }
  }

  protected *mapL2OrderBookChanges(message: DeribitBookMessage, localTimestamp: Date): IterableIterator<L2Change> {
    const deribitBookChange = message.params.data
    const isSnapshot = deribitBookChange.bids.every(e => e[0] == 'new') && deribitBookChange.asks.every(e => e[0] == 'new')
    yield {
      type: 'l2change',
      changeType: isSnapshot ? 'snapshot' : 'update',
      symbol: deribitBookChange.instrument_name,
      bids: deribitBookChange.bids.map(this._mapBookLevel),
      asks: deribitBookChange.asks.map(this._mapBookLevel),
      timestamp: new Date(deribitBookChange.timestamp),
      localTimestamp
    }
  }

  private _mapBookLevel(level: DeribitBookLevel) {
    const price = level[1]
    const amount = level[0] == 'delete' ? 0 : level[2]

    return { price, amount }
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
