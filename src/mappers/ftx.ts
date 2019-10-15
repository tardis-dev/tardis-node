import { MapperBase } from './mapper'
import { DataType, FilterForExchange, Trade, BookChange } from '../types'

// https://docs.ftx.com/#websocket-api

export class FtxMapper extends MapperBase {
  public supportedDataTypes = ['trade', 'book_change'] as const

  private readonly _dataTypeChannelMapping: { [key in DataType]?: FilterForExchange['ftx']['channel'] } = {
    book_change: 'orderbook',
    trade: 'trades'
  }

  protected mapDataTypeAndSymbolsToFilters(dataType: DataType, symbols?: string[]) {
    const channel = this._dataTypeChannelMapping[dataType]!

    return [
      {
        channel,
        symbols
      }
    ]
  }

  protected detectDataType(message: FtxTrades | FtxOrderBook): DataType | undefined {
    if (message.data === undefined) {
      return
    }

    if (message.channel === 'trades') {
      return 'trade'
    }

    if (message.channel === 'orderbook') {
      return 'book_change'
    }

    return
  }

  protected *mapTrades(ftxTrades: FtxTrades, localTimestamp: Date): IterableIterator<Trade> {
    for (const ftxTrade of ftxTrades.data) {
      yield {
        type: 'trade',
        symbol: ftxTrades.market,
        exchange: this.exchange,
        id: ftxTrade.id !== null ? String(ftxTrade.id) : undefined,
        price: ftxTrade.price,
        amount: ftxTrade.size,
        side: ftxTrade.side,
        timestamp: new Date(ftxTrade.time),
        localTimestamp: localTimestamp
      }
    }
  }

  protected *mapOrderBookChanges(ftxOrderBook: FtxOrderBook, localTimestamp: Date): IterableIterator<BookChange> {
    yield {
      type: 'book_change',
      symbol: ftxOrderBook.market,
      exchange: this.exchange,
      isSnapshot: ftxOrderBook.type === 'partial',
      bids: ftxOrderBook.data.bids.map(this._mapBookLevel),
      asks: ftxOrderBook.data.asks.map(this._mapBookLevel),
      timestamp: new Date(Math.floor(ftxOrderBook.data.time * 1000)),
      localTimestamp
    }
  }

  private _mapBookLevel(level: FtxBookLevel) {
    const price = level[0]
    const amount = level[1]

    return { price, amount }
  }
}

type FtxTrades = {
  channel: 'trades'
  market: string
  type: 'update'
  data: {
    id: number | null
    price: number
    size: number
    side: 'buy' | 'sell'
    time: string
  }[]
}

type FtxBookLevel = [number, number]

type FtxOrderBook = {
  channel: 'orderbook'
  market: string
  type: 'update' | 'partial'
  data: { time: number; bids: FtxBookLevel[]; asks: FtxBookLevel[] }
}
