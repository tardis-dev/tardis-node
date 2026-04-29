import { BookChange, BookTicker, Trade } from '../types.ts'
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
        side: (['buy', 'sell'] as const).find((side) => side === trade.side.toLowerCase()) ?? 'unknown',
        timestamp: new Date(trade.createdAtDatetime),
        localTimestamp
      }
    }
  }
}

export class BullishBookChangeMapper implements Mapper<'bullish', BookChange> {
  canHandle(message: BullishMessage) {
    return message.dataType === 'V1TALevel2'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'V1TALevel2' as const,
        symbols
      }
    ]
  }

  *map(_message: BullishMessage, _localTimestamp: Date): IterableIterator<BookChange> {
    return
  }
}

export class BullishBookTickerMapper implements Mapper<'bullish', BookTicker> {
  canHandle(message: BullishMessage) {
    return message.dataType === 'V1TALevel1' || message.dataType === 'V1TATickerResponse'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'V1TALevel1' as const,
        symbols
      },
      {
        channel: 'V1TATickerResponse' as const,
        symbols
      }
    ]
  }

  *map(_message: BullishMessage, _localTimestamp: Date): IterableIterator<BookTicker> {
    return
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
