import { Mapper, DataType, OrderBookL2Change, Quote, Ticker, Trade } from './mapper'
import { FilterForExchange } from '../consts'

export class DeribitMapper implements Mapper<'deribit'> {
  private readonly _dataTypeChannelMap: { [key in DataType]: FilterForExchange['deribit']['channel'] } = {
    l2Change: 'book',
    trade: 'trades',
    quote: 'quote',
    ticker: 'ticker'
  }

  getDataType(message: any): DataType | undefined {
    const channel = message.params && (message.params.channel as string | undefined)

    if (!channel) {
      return
    }

    if (channel.startsWith('trades')) {
      return 'trade'
    }

    if (channel.startsWith('book')) {
      return 'l2Change'
    }

    if (channel.startsWith('ticker')) {
      return 'ticker'
    }

    if (channel.startsWith('quote')) {
      return 'quote'
    }

    return
  }

  getFiltersForDataTypeAndSymbols(dataType: DataType, symbols?: string[]) {
    const channel = this._dataTypeChannelMap[dataType]
    return [
      {
        channel,
        symbols
      }
    ]
  }

  *mapTrades(message: DeribitTradesMessage, localTimestamp?: Date): IterableIterator<Trade> {
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

  *mapTickers(message: DeribitTickerMessage, localTimestamp?: Date): IterableIterator<Ticker> {
    const deribitTicker = message.params.data

    yield {
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

  *mapQuotes(message: DeribitQuoteMessage, localTimestamp?: Date): IterableIterator<Quote> {
    const deribitQuote = message.params.data

    yield {
      symbol: deribitQuote.instrument_name,
      bestBidPrice: deribitQuote.best_bid_price,
      bestBidAmount: deribitQuote.best_bid_amount,
      bestAskPrice: deribitQuote.best_ask_price,
      bestAskAmount: deribitQuote.best_ask_amount,
      timestamp: new Date(deribitQuote.timestamp),
      localTimestamp
    }
  }

  *mapOrderBookL2Changes(message: DeribitBookMessage, localTimestamp?: Date): IterableIterator<OrderBookL2Change> {
    const deribitBookChange = message.params.data

    yield {
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
