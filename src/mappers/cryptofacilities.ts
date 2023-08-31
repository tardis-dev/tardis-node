import { upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, DerivativeTicker, Liquidation, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://www.cryptofacilities.com/resources/hc/en-us/categories/115000132213-API

export const cryptofacilitiesTradesMapper: Mapper<'cryptofacilities', Trade> = {
  canHandle(message: CryptofacilitiesTrade | CryptofacilitiesTicker | CryptofacilitiesBookSnapshot | CryptofacilitiesBookUpdate) {
    return message.feed === 'trade' && message.event === undefined
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

  *map(trade: CryptofacilitiesTrade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: trade.product_id,
      exchange: 'cryptofacilities',
      id: trade.uid,
      price: trade.price,
      amount: trade.qty,
      side: trade.side,
      timestamp: new Date(trade.time),
      localTimestamp: localTimestamp
    }
  }
}

const mapBookLevel = ({ price, qty }: CryptofacilitiesBookLevel) => {
  return { price, amount: qty < 0 ? 0 : qty }
}

export const cryptofacilitiesBookChangeMapper: Mapper<'cryptofacilities', BookChange> = {
  canHandle(message: CryptofacilitiesTrade | CryptofacilitiesTicker | CryptofacilitiesBookSnapshot | CryptofacilitiesBookUpdate) {
    return message.event === undefined && (message.feed === 'book' || message.feed === 'book_snapshot')
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'book',
        symbols
      },
      {
        channel: 'book_snapshot',
        symbols
      }
    ]
  },

  *map(message: CryptofacilitiesBookSnapshot | CryptofacilitiesBookUpdate, localTimestamp: Date): IterableIterator<BookChange> {
    if (message.feed === 'book_snapshot') {
      yield {
        type: 'book_change',
        symbol: message.product_id,
        exchange: 'cryptofacilities',
        isSnapshot: true,
        bids: message.bids.map(mapBookLevel),
        asks: message.asks.map(mapBookLevel),
        timestamp: message.timestamp !== undefined ? new Date(message.timestamp) : localTimestamp,
        localTimestamp: localTimestamp
      }
    } else {
      const isAsk = message.side === 'sell'
      const update = [
        {
          price: message.price,
          amount: message.qty < 0 ? 0 : message.qty
        }
      ]

      yield {
        type: 'book_change',
        symbol: message.product_id,
        exchange: 'cryptofacilities',
        isSnapshot: false,
        bids: isAsk ? [] : update,
        asks: isAsk ? update : [],
        timestamp: message.timestamp !== undefined ? new Date(message.timestamp) : localTimestamp,
        localTimestamp: localTimestamp
      }
    }
  }
}

export class CryptofacilitiesDerivativeTickerMapper implements Mapper<'cryptofacilities', DerivativeTicker> {
  constructor(private readonly _useRelativeFundingRate: boolean) {}
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()
  canHandle(message: CryptofacilitiesTrade | CryptofacilitiesTicker | CryptofacilitiesBookSnapshot | CryptofacilitiesBookUpdate) {
    return message.feed === 'ticker' && message.event === undefined
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'ticker',
        symbols
      } as const
    ]
  }

  *map(ticker: CryptofacilitiesTicker, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(ticker.product_id, 'cryptofacilities')

    if (ticker.next_funding_rate_time === 0) {
      return
    }

    if (this._useRelativeFundingRate) {
      pendingTickerInfo.updateFundingRate(ticker.relative_funding_rate)
      pendingTickerInfo.updatePredictedFundingRate(ticker.relative_funding_rate_prediction)
    } else {
      pendingTickerInfo.updateFundingRate(ticker.funding_rate)
      pendingTickerInfo.updatePredictedFundingRate(ticker.funding_rate_prediction)
    }
    pendingTickerInfo.updateFundingTimestamp(
      ticker.next_funding_rate_time !== undefined ? new Date(ticker.next_funding_rate_time) : undefined
    )
    pendingTickerInfo.updateIndexPrice(ticker.index)
    pendingTickerInfo.updateMarkPrice(ticker.markPrice)
    pendingTickerInfo.updateOpenInterest(ticker.openInterest)
    pendingTickerInfo.updateLastPrice(ticker.last)
    pendingTickerInfo.updateTimestamp(new Date(ticker.time))

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

export const cryptofacilitiesLiquidationsMapper: Mapper<'cryptofacilities', Liquidation> = {
  canHandle(message: CryptofacilitiesTrade | CryptofacilitiesTicker | CryptofacilitiesBookSnapshot | CryptofacilitiesBookUpdate) {
    return message.feed === 'trade' && message.event === undefined && message.type === 'liquidation'
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

  *map(liquidationTrade: CryptofacilitiesTrade, localTimestamp: Date): IterableIterator<Liquidation> {
    yield {
      type: 'liquidation',
      symbol: liquidationTrade.product_id,
      exchange: 'cryptofacilities',
      id: liquidationTrade.uid,
      price: liquidationTrade.price,
      amount: liquidationTrade.qty,
      side: liquidationTrade.side,
      timestamp: new Date(liquidationTrade.time),
      localTimestamp: localTimestamp
    }
  }
}

export const cryptofacilitiesBookTickerMapper: Mapper<'cryptofacilities', BookTicker> = {
  canHandle(message: CryptofacilitiesTicker) {
    return message.feed === 'ticker' && message.event === undefined
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'ticker',
        symbols
      }
    ]
  },

  *map(cryptofacilitiesTicker: CryptofacilitiesTicker, localTimestamp: Date): IterableIterator<BookTicker> {
    const ticker: BookTicker = {
      type: 'book_ticker',
      symbol: cryptofacilitiesTicker.product_id,
      exchange: 'cryptofacilities',

      askAmount: cryptofacilitiesTicker.ask_size,
      askPrice: cryptofacilitiesTicker.ask,

      bidPrice: cryptofacilitiesTicker.bid,
      bidAmount: cryptofacilitiesTicker.bid_size,
      timestamp: new Date(cryptofacilitiesTicker.time),
      localTimestamp: localTimestamp
    }

    yield ticker
  }
}

type CryptofacilitiesTrade = {
  feed: 'trade'
  type: 'liquidation' | 'fill'
  uid: string | undefined
  event: undefined
  product_id: string
  side: 'buy' | 'sell'
  time: number
  qty: number
  price: number
}

type CryptofacilitiesTicker =
  | {
      feed: 'ticker'
      event: undefined
      product_id: string
      index: number
      last: number
      openInterest: number
      markPrice: number
      funding_rate: number | undefined
      funding_rate_prediction: number | undefined
      next_funding_rate_time: number | undefined
      time: number
      bid: number | undefined
      ask: number | undefined
      bid_size: number | undefined
      ask_size: number | undefined
      relative_funding_rate: undefined
      relative_funding_rate_prediction: undefined
    }
  | {
      time: 1680307200005
      product_id: 'PF_1INCHUSD'
      event: undefined
      funding_rate: -1.861241614653e-6
      funding_rate_prediction: -4.87669653882e-6
      relative_funding_rate: number | undefined
      relative_funding_rate_prediction: number | undefined
      next_funding_rate_time: 1680307200000
      feed: 'ticker'
      bid: 0.5609
      ask: 0.5621
      bid_size: 1123.0
      ask_size: 8931.0
      volume: 10902.0
      dtm: 0
      leverage: '10x'
      index: 0.56158
      premium: -0.0
      last: 0.5594
      change: -1.0086710316758118
      suspended: false
      tag: 'perpetual'
      pair: '1INCH:USD'
      openInterest: 27481.0
      markPrice: 0.56147544277
      maturityTime: 0
      post_only: false
      volumeQuote: 6028.1795
    }

type CryptofacilitiesBookLevel = {
  price: number
  qty: number
}

type CryptofacilitiesBookSnapshot = {
  feed: 'book_snapshot'
  event: undefined
  product_id: string
  timestamp: number | undefined
  bids: CryptofacilitiesBookLevel[]
  asks: CryptofacilitiesBookLevel[]
}

type CryptofacilitiesBookUpdate = {
  feed: 'book'
  event: undefined
  product_id: string
  side: 'buy' | 'sell'
  price: number
  qty: number
  timestamp: number | undefined
}
