import { MapperBase } from './mapper'
import { DataType, FilterForExchange, Trade, BookChange } from '../types'

// https://docs.pro.coinbase.com/#websocket-feed

export class CoinbaseMapper extends MapperBase {
  public supportedDataTypes = ['trade', 'book_change'] as const

  private readonly _dataTypeChannelMapping: { [key in DataType]?: FilterForExchange['coinbase']['channel'][] } = {
    book_change: ['snapshot', 'l2update'],
    trade: ['match']
  }

  protected mapDataTypeAndSymbolsToFilters(dataType: DataType, symbols?: string[]) {
    const channels = this._dataTypeChannelMapping[dataType]!

    return channels.map(channel => {
      return {
        channel,
        symbols
      }
    })
  }

  protected detectDataType(message: CoinbaseTrade | CoinbaseLevel2Snapshot | CoinbaseLevel2Update): DataType | undefined {
    if (message.type === 'match') {
      return 'trade'
    }

    if (message.type === 'l2update' || message.type === 'snapshot') {
      return 'book_change'
    }

    return
  }

  protected *mapTrades(message: CoinbaseTrade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: message.product_id,
      id: String(message.trade_id),
      price: Number(message.price),
      amount: Number(message.size),
      side: message.side === 'sell' ? 'buy' : 'sell', // coinbase side field indicates the maker order side
      timestamp: new Date(message.time),
      localTimestamp: localTimestamp
    }
  }

  protected *mapOrderBookChanges(
    message: CoinbaseLevel2Update | CoinbaseLevel2Snapshot,
    localTimestamp: Date
  ): IterableIterator<BookChange> {
    if (message.type === 'snapshot') {
      yield {
        type: 'book_change',
        symbol: message.product_id,
        isSnapshot: true,
        bids: message.bids.map(this._mapSnapshotBookLevel),
        asks: message.asks.map(this._mapSnapshotBookLevel),
        timestamp: localTimestamp,
        localTimestamp
      }
    } else {
      yield {
        type: 'book_change',
        symbol: message.product_id,
        isSnapshot: false,
        bids: message.changes.filter(c => c[0] === 'buy').map(this._mapUpdateBookLevel),
        asks: message.changes.filter(c => c[0] === 'sell').map(this._mapUpdateBookLevel),
        timestamp: new Date(message.time),
        localTimestamp: localTimestamp
      }
    }
  }

  private _mapUpdateBookLevel(level: CoinbaseUpdateBookLevel) {
    const price = Number(level[1])
    const amount = Number(level[2])

    return { price, amount }
  }

  private _mapSnapshotBookLevel(level: CoinbaseSnapshotBookLevel) {
    const price = Number(level[0])
    const amount = Number(level[1])

    return { price, amount }
  }
}

type CoinbaseTrade = {
  type: 'match'
  trade_id: number
  time: string
  product_id: string
  size: string
  price: string
  side: 'sell' | 'buy'
}

type CoinbaseSnapshotBookLevel = [string, string]

type CoinbaseLevel2Snapshot = {
  type: 'snapshot'
  product_id: string
  bids: CoinbaseSnapshotBookLevel[]
  asks: CoinbaseSnapshotBookLevel[]
}

type CoinbaseUpdateBookLevel = ['buy' | 'sell', string, string]

type CoinbaseLevel2Update = {
  type: 'l2update'
  product_id: string
  time: string
  changes: CoinbaseUpdateBookLevel[]
}
