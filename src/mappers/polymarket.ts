import { BookChange, BookTicker, Trade } from '../types.ts'
import { asNonZeroNumberOrUndefined } from '../handy.ts'
import { Mapper } from './mapper.ts'

type PolymarketBookChangeMapperMessage = PolymarketClobBookMessage | PolymarketClobBookMessage[] | PolymarketClobPriceChangeMessage
export class PolymarketBookChangeMapper implements Mapper<'polymarket', BookChange> {
  canHandle(message: PolymarketNativeMessage): message is PolymarketBookChangeMapperMessage {
    if (Array.isArray(message)) {
      return message.length > 0 && message.every(isPolymarketClobBookMessage)
    }
    return isPolymarketClobPriceChangeMessage(message) || isPolymarketClobBookMessage(message)
  }

  getFilters(symbols?: string[]) {
    return [
      { channel: 'book' as const, symbols },
      { channel: 'price_change' as const, symbols }
    ]
  }

  *map(message: PolymarketNativeMessage, localTimestamp: Date): IterableIterator<BookChange> {
    if (Array.isArray(message)) {
      for (const bookMsg of message) {
        yield this.mapBookSnapshot(bookMsg, localTimestamp)
      }
      return
    }

    if (isPolymarketClobPriceChangeMessage(message)) {
      const timestamp = new Date(Number(message.timestamp))
      const changes = message.price_changes

      for (let i = 0; i < changes.length; i++) {
        const change = changes[i]
        const level = this.mapLevel(change)

        yield {
          type: 'book_change',
          symbol: change.asset_id,
          exchange: 'polymarket',
          isSnapshot: false,
          bids: change.side === 'BUY' ? [level] : [],
          asks: change.side === 'SELL' ? [level] : [],
          timestamp,
          localTimestamp
        }
      }

      return
    }

    if (isPolymarketClobBookMessage(message)) {
      yield this.mapBookSnapshot(message, localTimestamp)
      return
    }
  }

  private mapBookSnapshot(message: PolymarketClobBookMessage, localTimestamp: Date): BookChange {
    return {
      type: 'book_change',
      symbol: message.asset_id,
      exchange: 'polymarket',
      isSnapshot: true,
      bids: message.bids.map(this.mapLevel.bind(this)),
      asks: message.asks.map(this.mapLevel.bind(this)),
      timestamp: new Date(Number(message.timestamp)),
      localTimestamp
    }
  }

  private mapLevel(level: Pick<PolymarketClobBookLevel, 'price' | 'size'>) {
    return {
      price: Number(level.price),
      amount: Number(level.size)
    }
  }
}

export class PolymarketTradesMapper implements Mapper<'polymarket', Trade> {
  canHandle(message: any): message is PolymarketClobLastTradePriceMessage {
    return message.event_type === 'last_trade_price'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'last_trade_price' as const, symbols }]
  }

  *map(message: PolymarketClobLastTradePriceMessage, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: message.asset_id,
      exchange: 'polymarket',
      id: message.transaction_hash,
      price: Number(message.price),
      amount: Number(message.size),
      side: message.side.toLowerCase() as Lowercase<PolymarketClobTradeSide>,
      timestamp: new Date(Number(message.timestamp)),
      localTimestamp
    }
  }
}

export class PolymarketBookTickerMapper implements Mapper<'polymarket', BookTicker> {
  canHandle(message: any): message is PolymarketClobBestBidAskMessage {
    return message.event_type === 'best_bid_ask'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'best_bid_ask' as const, symbols }]
  }

  *map(message: PolymarketClobBestBidAskMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    yield {
      type: 'book_ticker',
      symbol: message.asset_id,
      exchange: 'polymarket',
      bidPrice: asNonZeroNumberOrUndefined(message.best_bid),
      bidAmount: undefined,
      askPrice: asNonZeroNumberOrUndefined(message.best_ask),
      askAmount: undefined,
      timestamp: new Date(Number(message.timestamp)),
      localTimestamp
    }
  }
}

export type PolymarketNativeMessage =
  | PolymarketClobBookMessage
  | PolymarketClobBookMessage[]
  | PolymarketClobPriceChangeMessage
  | PolymarketClobLastTradePriceMessage
  | PolymarketClobBestBidAskMessage

type PolymarketClobEventType = 'book' | 'price_change' | 'last_trade_price' | 'best_bid_ask'

type PolymarketClobMessage<T extends PolymarketClobEventType = PolymarketClobEventType> = {
  event_type: T
  market: string
}

function isPolymarketClobBookMessage(message: any): message is PolymarketClobBookMessage {
  return message?.event_type === 'book'
}
type PolymarketClobBookMessage = PolymarketClobMessage<'book'> & {
  asset_id: string
  timestamp: string
  hash: string
  bids: PolymarketClobBookLevel[]
  asks: PolymarketClobBookLevel[]
  tick_size?: string
  last_trade_price?: string
}

type PolymarketClobBookLevel = {
  price: string
  size: string
}

function isPolymarketClobPriceChangeMessage(message: any): message is PolymarketClobPriceChangeMessage {
  return message?.event_type === 'price_change'
}
type PolymarketClobPriceChangeMessage = PolymarketClobMessage<'price_change'> & {
  timestamp: string
  price_changes: PolymarketClobPriceChange[]
}

type PolymarketClobPriceChange = {
  asset_id: string
  price: string
  size: string
  side: PolymarketClobTradeSide
  hash: string
  best_bid: string
  best_ask: string
}

type PolymarketClobLastTradePriceMessage = PolymarketClobMessage<'last_trade_price'> & {
  asset_id: string
  fee_rate_bps: string
  price: string
  side: PolymarketClobTradeSide
  size: string
  timestamp: string
  transaction_hash: string
}

type PolymarketClobTradeSide = 'BUY' | 'SELL'

type PolymarketClobBestBidAskMessage = PolymarketClobMessage<'best_bid_ask'> & {
  asset_id: string
  best_bid: string
  best_ask: string
  spread: string
  timestamp: string
}
