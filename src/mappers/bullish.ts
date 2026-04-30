import { asNumberIfValid } from '../handy.ts'
import { BookChange, BookPriceLevel, BookTicker, Trade } from '../types.ts'
import { Mapper } from './mapper.ts'

export class BullishTradesMapper implements Mapper<'bullish', Trade> {
  canHandle(message: BullishMessage): message is BullishAnonymousTradeUpdateMessage {
    return message.dataType === 'V1TAAnonymousTradeUpdate' && (message.type === 'snapshot' || message.type === 'update')
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'V1TAAnonymousTradeUpdate' as const,
        symbols
      }
    ]
  }

  *map(message: BullishAnonymousTradeUpdateMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const trade of message.data.trades) {
      yield {
        type: 'trade',
        symbol: trade.symbol,
        exchange: 'bullish',
        id: trade.tradeId,
        price: Number(trade.price),
        amount: Number(trade.quantity),
        side: trade.side.toLowerCase() as 'buy' | 'sell',
        timestamp: new Date(trade.createdAtDatetime),
        localTimestamp
      }
    }
  }
}

export class BullishBookChangeMapper implements Mapper<'bullish', BookChange> {
  canHandle(message: BullishMessage): message is BullishLevel2Message {
    return message.dataType === 'V1TALevel2' && (message.type === 'snapshot' || message.type === 'update')
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'V1TALevel2' as const,
        symbols
      }
    ]
  }

  *map(message: BullishLevel2Message, localTimestamp: Date): IterableIterator<BookChange> {
    yield {
      type: 'book_change',
      symbol: message.data.symbol,
      exchange: 'bullish',
      isSnapshot: message.type === 'snapshot',
      bids: this.mapLevels(message.data.bids),
      asks: this.mapLevels(message.data.asks),
      timestamp: new Date(message.data.datetime),
      localTimestamp
    }
  }

  private mapLevels(levels: string[]): BookPriceLevel[] {
    return levels.reduce<BookPriceLevel[]>((result, value, index) => {
      if (index % 2 === 0) {
        result.push({
          price: Number(value),
          amount: Number(levels[index + 1])
        })
      }

      return result
    }, [])
  }
}

export class BullishBookTickerMapper implements Mapper<'bullish', BookTicker> {
  canHandle(message: BullishMessage): message is BullishLevel1Message {
    return message.dataType === 'V1TALevel1' && (message.type === 'snapshot' || message.type === 'update')
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'V1TALevel1' as const,
        symbols
      }
    ]
  }

  *map(message: BullishLevel1Message, localTimestamp: Date): IterableIterator<BookTicker> {
    yield {
      type: 'book_ticker',
      symbol: message.data.symbol,
      exchange: 'bullish',
      bidPrice: asNumberIfValid(message.data.bid[0]),
      bidAmount: asNumberIfValid(message.data.bid[1]),
      askPrice: asNumberIfValid(message.data.ask[0]),
      askAmount: asNumberIfValid(message.data.ask[1]),
      timestamp: new Date(message.data.datetime),
      localTimestamp
    }
  }
}

type BullishMessage = BullishDataMessage<string, unknown>
type BullishDataMessage<TDataType extends string, TData> = {
  type: BullishMessageRole
  dataType: TDataType
  data: TData
}
type BullishMessageRole = 'snapshot' | 'update'

type BullishAnonymousTradeUpdateMessage = BullishDataMessage<'V1TAAnonymousTradeUpdate', BullishAnonymousTradeUpdateData>
type BullishLevel2Message = BullishDataMessage<'V1TALevel2', BullishLevel2Data>
type BullishLevel1Message = BullishDataMessage<'V1TALevel1', BullishLevel1Data>

type BullishAnonymousTradeUpdateData = {
  symbol: string
  createdAtTimestamp: string
  publishedAtTimestamp: string
  trades: BullishAnonymousTrade[]
}
type BullishAnonymousTrade = {
  symbol: string
  tradeId: string
  price: string
  quantity: string
  side: BullishTradeSide
  isTaker: boolean
  createdAtTimestamp: string
  publishedAtTimestamp: string
  lastUpdatedTimestamp: string
  createdAtDatetime: string
}
type BullishTradeSide = 'BUY' | 'SELL'

type BullishLevel2Data = {
  timestamp: string
  bids: string[]
  asks: string[]
  publishedAtTimestamp: string
  datetime: string
  sequenceNumberRange: [number, number]
  symbol: string
}

type BullishLevel1Data = {
  timestamp: string
  bid: [string, string]
  ask: [string, string]
  publishedAtTimestamp: string
  datetime: string
  sequenceNumber: string
  symbol: string
}
