import { MapperBase } from './mapper'
import { DataType, FilterForExchange, Trade, BookChange } from '../types'

// https://docs.gemini.com/websocket-api/#market-data-version-2

export class GeminiMapper extends MapperBase {
  public supportedDataTypes = ['trade', 'book_change'] as const

  private readonly _dataTypeChannelMapping: { [key in DataType]?: FilterForExchange['gemini']['channel'] } = {
    book_change: 'l2_updates',
    trade: 'trade'
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

  protected detectDataType(message: GeminiL2Updates | GeminiTrade): DataType | undefined {
    if (message.type === 'trade') {
      return 'trade'
    }

    if (message.type === 'l2_updates') {
      return 'book_change'
    }

    return
  }

  protected *mapTrades(geminiTrade: GeminiTrade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: geminiTrade.symbol,
      id: String(geminiTrade.event_id),
      price: Number(geminiTrade.price),
      amount: Number(geminiTrade.quantity),
      side: geminiTrade.side,
      timestamp: new Date(geminiTrade.timestamp),
      localTimestamp: localTimestamp
    }
  }

  protected *mapOrderBookChanges(geminiL2Updates: GeminiL2Updates, localTimestamp: Date): IterableIterator<BookChange> {
    yield {
      type: 'book_change',
      symbol: geminiL2Updates.symbol,
      isSnapshot: geminiL2Updates.auction_events !== undefined,
      bids: geminiL2Updates.changes.filter(c => c[0] === 'buy').map(this._mapBookLevel),
      asks: geminiL2Updates.changes.filter(c => c[0] === 'sell').map(this._mapBookLevel),

      timestamp: localTimestamp,
      localTimestamp
    }
  }

  private _mapBookLevel(level: GeminiBookLevel) {
    const price = Number(level[1])
    const amount = Number(level[2])

    return { price, amount }
  }
}

type GeminiBookLevel = ['buy' | 'sell', string, string]

type GeminiL2Updates = {
  type: 'l2_updates'
  symbol: string
  changes: GeminiBookLevel[]
  auction_events: any[]
}

type GeminiTrade = {
  type: 'trade'
  symbol: string
  event_id: number
  timestamp: number
  price: string
  quantity: string
  side: 'sell' | 'buy'
}
