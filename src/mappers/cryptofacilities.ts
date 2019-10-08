import { DataType, DerivativeTicker, Trade, BookChange, FilterForExchange } from '../types'
import { MapperBase } from './mapper'

// https://www.cryptofacilities.com/resources/hc/en-us/categories/115000132213-API

export class CryptofacilitiesMapper extends MapperBase {
  public supportedDataTypes = ['trade', 'book_change', 'derivative_ticker'] as const

  private readonly _dataTypeChannelMapping: { [key in DataType]: FilterForExchange['cryptofacilities']['channel'][] } = {
    book_change: ['book', 'book_snapshot'],
    trade: ['book'],
    derivative_ticker: ['ticker']
  }

  protected mapDataTypeAndSymbolsToFilters(dataType: DataType, symbols?: string[]) {
    const channels = this._dataTypeChannelMapping[dataType]
    return channels.map(channel => {
      return {
        channel,
        symbols
      }
    })
  }

  protected detectDataType(
    message: CryptofacilitiesTrade | CryptofacilitiesTicker | CryptofacilitiesBookSnapshot | CryptofacilitiesBookUpdate
  ): DataType | undefined {
    if (message.event !== undefined) {
      return
    }

    if (message.feed === 'trade') {
      return 'trade'
    }

    if (message.feed === 'book' || message.feed === 'book_snapshot') {
      return 'book_change'
    }

    if (message.feed === 'ticker') {
      return 'derivative_ticker'
    }

    return
  }

  protected *mapTrades(trade: CryptofacilitiesTrade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: trade.product_id,
      id: trade.uid,
      price: trade.price,
      amount: trade.qty,
      side: trade.side,
      timestamp: new Date(trade.time),
      localTimestamp: localTimestamp
    }
  }

  protected *mapDerivativeTickerInfo(ticker: CryptofacilitiesTicker, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const pendingTickerInfo = this.getPendingTickerInfo(ticker.product_id)

    pendingTickerInfo.updateFundingRate(ticker.funding_rate)
    pendingTickerInfo.updateIndexPrice(ticker.index)
    pendingTickerInfo.updateMarkPrice(ticker.markPrice)
    pendingTickerInfo.updateOpenInterest(ticker.openInterest)
    pendingTickerInfo.updateLastPrice(ticker.last)

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(new Date(ticker.time), localTimestamp)
    }
  }

  protected *mapOrderBookChanges(
    message: CryptofacilitiesBookSnapshot | CryptofacilitiesBookUpdate,
    localTimestamp: Date
  ): IterableIterator<BookChange> {
    if (message.feed === 'book_snapshot') {
      yield {
        type: 'book_change',
        symbol: message.product_id,
        isSnapshot: true,
        bids: message.bids.map(this._mapBookLevel),
        asks: message.asks.map(this._mapBookLevel),
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
        isSnapshot: false,
        bids: isAsk ? [] : update,
        asks: isAsk ? update : [],
        timestamp: message.timestamp !== undefined ? new Date(message.timestamp) : localTimestamp,
        localTimestamp: localTimestamp
      }
    }
  }

  private _mapBookLevel({ price, qty }: CryptofacilitiesBookLevel) {
    return { price, amount: qty }
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
