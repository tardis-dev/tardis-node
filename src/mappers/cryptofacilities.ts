import { BookChange, DerivativeTicker, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://www.cryptofacilities.com/resources/hc/en-us/categories/115000132213-API

export const cryptofacilitiesTradesMapper: Mapper<'cryptofacilities', Trade> = {
  canHandle(message: CryptofacilitiesTrade | CryptofacilitiesTicker | CryptofacilitiesBookSnapshot | CryptofacilitiesBookUpdate) {
    return message.feed === 'trade'
  },

  getFilters(symbols?: string[]) {
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
  return { price, amount: qty }
}

export const cryptofacilitiesBookChangeMapper: Mapper<'cryptofacilities', BookChange> = {
  canHandle(message: CryptofacilitiesTrade | CryptofacilitiesTicker | CryptofacilitiesBookSnapshot | CryptofacilitiesBookUpdate) {
    return message.feed === 'book' || message.feed === 'book_snapshot'
  },

  getFilters(symbols?: string[]) {
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
          amount: message.qty
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
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()
  canHandle(message: CryptofacilitiesTrade | CryptofacilitiesTicker | CryptofacilitiesBookSnapshot | CryptofacilitiesBookUpdate) {
    return message.feed === 'ticker'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'ticker',
        symbols
      } as const
    ]
  }

  *map(ticker: CryptofacilitiesTicker, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(ticker.product_id, 'cryptofacilities')

    pendingTickerInfo.updateFundingRate(ticker.funding_rate)
    pendingTickerInfo.updatePredictedFundingRate(ticker.funding_rate_prediction)
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

type CryptofacilitiesTrade = {
  feed: 'trade'
  uid: string | undefined
  event: undefined
  product_id: string
  side: 'buy' | 'sell'
  time: number
  qty: number
  price: number
}

type CryptofacilitiesTicker = {
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
