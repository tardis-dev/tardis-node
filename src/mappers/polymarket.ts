import { BookChange, BookTicker, Trade } from '../types.ts'
import { asNumberIfValid, asNumberOrUndefined } from '../handy.ts'
import { Mapper } from './mapper.ts'

type PolymarketBookChangeMapperMessage = PolymarketClobBookMessage | PolymarketClobBookMessage[] | PolymarketClobPriceChangeMessage
export class PolymarketBookChangeMapper implements Mapper<'polymarket', BookChange> {
  canHandle(message: PolymarketNativeMessage): message is PolymarketBookChangeMapperMessage {
    if (Array.isArray(message)) {
      return message.length > 0 && message.every(isPolymarketClobBookMessage)
    }
    return isPolymarketClobBookMessage(message) || isPolymarketClobPriceChangeMessage(message)
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

    if (isPolymarketClobBookMessage(message)) {
      yield this.mapBookSnapshot(message, localTimestamp)
      return
    }

    if (isPolymarketClobPriceChangeMessage(message)) {
      yield* this.mapPriceChange(message, localTimestamp)
    }
  }

  private mapBookSnapshot(message: PolymarketClobBookMessage, localTimestamp: Date): BookChange {
    return {
      type: 'book_change',
      symbol: message.asset_id,
      exchange: 'polymarket',
      isSnapshot: true,
      bids: message.bids.map((level) => this.mapLevel(level)),
      asks: message.asks.map((level) => this.mapLevel(level)),
      timestamp: new Date(Number(message.timestamp)),
      localTimestamp
    }
  }

  private *mapPriceChange(message: PolymarketClobPriceChangeMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const messageTimestamp = new Date(Number(message.timestamp))
    const changesByAsset = new Map<string, Pick<BookChange, 'bids' | 'asks'>>()

    for (const change of message.price_changes) {
      if (!changesByAsset.has(change.asset_id)) {
        changesByAsset.set(change.asset_id, { bids: [], asks: [] })
      }

      const assetChanges = changesByAsset.get(change.asset_id)!
      if (change.side === 'BUY') {
        assetChanges.bids.push(this.mapLevel(change))
      } else {
        assetChanges.asks.push(this.mapLevel(change))
      }
    }

    for (const [assetId, changes] of changesByAsset) {
      yield {
        type: 'book_change',
        symbol: assetId,
        exchange: 'polymarket',
        isSnapshot: false,
        bids: changes.bids,
        asks: changes.asks,
        timestamp: messageTimestamp,
        localTimestamp
      }
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
  canHandle(message: PolymarketNativeMessage): message is PolymarketClobLastTradePriceMessage {
    return Array.isArray(message) === false && 'event_type' in message && message.event_type === 'last_trade_price'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'last_trade_price' as const, symbols }]
  }

  *map(message: PolymarketClobLastTradePriceMessage, localTimestamp: Date): IterableIterator<Trade> {
    const price = asNumberOrUndefined(message.price)
    if (price === undefined) {
      return
    }

    yield {
      type: 'trade',
      symbol: message.asset_id,
      exchange: 'polymarket',
      id: message.transaction_hash,
      price,
      amount: asNumberOrUndefined(message.size) ?? 0,
      side: message.side.toLowerCase() as Lowercase<PolymarketClobTradeSide>,
      timestamp: new Date(Number(message.timestamp)),
      localTimestamp
    }
  }
}

export class PolymarketBookTickerMapper implements Mapper<'polymarket', BookTicker> {
  canHandle(message: PolymarketNativeMessage): message is PolymarketClobBestBidAskMessage {
    return Array.isArray(message) === false && 'event_type' in message && message.event_type === 'best_bid_ask'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'best_bid_ask' as const, symbols }]
  }

  *map(message: PolymarketClobBestBidAskMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    yield {
      type: 'book_ticker',
      symbol: message.asset_id,
      exchange: 'polymarket',
      bidPrice: asNumberIfValid(message.best_bid),
      bidAmount: undefined,
      askPrice: asNumberIfValid(message.best_ask),
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
  | PolymarketClobTickSizeChangeMessage
  | PolymarketClobBestBidAskMessage
  | PolymarketClobNewMarketMessage
  | PolymarketClobResolvedMessage
  | PolymarketSportsResultMessage

type PolymarketClobEventType =
  | 'book'
  | 'price_change'
  | 'tick_size_change'
  | 'last_trade_price'
  | 'best_bid_ask'
  | 'new_market'
  | 'market_resolved'

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

type PolymarketClobTickSizeChangeMessage = PolymarketClobMessage<'tick_size_change'> & {
  asset_id: string
  old_tick_size: string
  new_tick_size: string
  timestamp: string
}

type PolymarketClobBestBidAskMessage = PolymarketClobMessage<'best_bid_ask'> & {
  asset_id: string
  best_bid: string
  best_ask: string
  spread: string
  timestamp: string
}

type PolymarketClobNewMarketMessage = PolymarketClobMessage<'new_market'> & {
  id: string
  question: string
  slug: string
  description: string
  assets_ids: string[]
  outcomes: string[]
  event_message: PolymarketClobEventMessage
  timestamp: string
  tags: string[]
  condition_id: string
  active: boolean
  clob_token_ids: string[]
  sports_market_type: string
  line: string
  game_start_time: string
  order_price_min_tick_size: string
  group_item_title: string
  taker_base_fee?: string
  fees_enabled?: boolean
  fee_schedule?: PolymarketClobFeeSchedule
}

type PolymarketClobEventMessage = {
  id: string
  ticker: string
  slug: string
  title: string
  description: string
}

type PolymarketClobFeeSchedule = {
  exponent: string
  rate: string
  taker_only: boolean
  rebate_rate: string
}

type PolymarketClobResolvedMessage = PolymarketClobMessage<'market_resolved'> & {
  id: string
  assets_ids: string[]
  winning_asset_id: string
  winning_outcome: string
  timestamp: string
  tags: string[]
}

type PolymarketSportsResultMessage = {
  gameId?: number
  leagueAbbreviation?: string
  slug?: string
  homeTeam?: string
  awayTeam?: string
  status?: PolymarketSportsStatus
  eventState?: PolymarketSportsEventState
  score: string
  period: string
  elapsed?: string
  last_update?: string
  live: boolean
  ended: boolean
  turn?: string
  finished_timestamp?: string
}

type PolymarketSportsEventState = {
  type: string
  createdAt: string
  updatedAt: string
  score: string
  period: string
  live: boolean
  ended: boolean
  tournamentName?: string
  tennisRound?: string
}

type PolymarketSportsStatus =
  | 'Scheduled'
  | 'InProgress'
  | 'Final'
  | 'F/OT'
  | 'F/SO'
  | 'Suspended'
  | 'Postponed'
  | 'Delayed'
  | 'Canceled'
  | 'Forfeit'
  | 'NotNecessary'
  | 'Break'
  | 'PenaltyShootout'
  | 'Awarded'
  | 'not_started'
  | 'running'
  | 'finished'
  | 'postponed'
  | 'canceled'
  | 'scheduled'
  | 'inprogress'
  | 'suspended'
  | 'cancelled'
