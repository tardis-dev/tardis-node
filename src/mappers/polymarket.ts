import { BookChange, BookTicker, Trade } from '../types.ts'
import { asNumberOrUndefined } from '../handy.ts'
import { Mapper } from './mapper.ts'

type PolymarketBookChangeMapperMessage = PolymarketMarketBookMessage | PolymarketMarketBookMessage[] | PolymarketMarketPriceChangeMessage
export class PolymarketBookChangeMapper implements Mapper<'polymarket', BookChange> {
  canHandle(message: PolymarketNativeMessage): message is PolymarketBookChangeMapperMessage {
    if (Array.isArray(message)) {
      return message.length > 0 && message.every(isPolymarketMarketBookMessage)
    }
    return isPolymarketMarketBookMessage(message) || isPolymarketMarketPriceChangeMessage(message)
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

    if (isPolymarketMarketBookMessage(message)) {
      yield this.mapBookSnapshot(message, localTimestamp)
      return
    }

    if (isPolymarketMarketPriceChangeMessage(message)) {
      yield* this.mapPriceChange(message, localTimestamp)
    }
  }

  private mapBookSnapshot(message: PolymarketMarketBookMessage, localTimestamp: Date): BookChange {
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

  private *mapPriceChange(message: PolymarketMarketPriceChangeMessage, localTimestamp: Date): IterableIterator<BookChange> {
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

  private mapLevel(level: Pick<PolymarketMarketBookLevel, 'price' | 'size'>) {
    return {
      price: Number(level.price),
      amount: Number(level.size)
    }
  }
}
type PolymarketMarketEventType =
  | 'book'
  | 'price_change'
  | 'tick_size_change'
  | 'last_trade_price'
  | 'best_bid_ask'
  | 'new_market'
  | 'market_resolved'

type PolymarketMarketMessage<T extends PolymarketMarketEventType = PolymarketMarketEventType> = {
  event_type: T
  market: string
}

function isPolymarketMarketBookMessage(message: any): message is PolymarketMarketBookMessage {
  return message?.event_type === 'book'
}
type PolymarketMarketBookMessage = PolymarketMarketMessage<'book'> & {
  asset_id: string
  timestamp: string
  hash: string
  bids: PolymarketMarketBookLevel[]
  asks: PolymarketMarketBookLevel[]
  tick_size?: string
  last_trade_price?: string
}

type PolymarketMarketBookLevel = {
  price: string
  size: string
}

function isPolymarketMarketPriceChangeMessage(message: any): message is PolymarketMarketPriceChangeMessage {
  return message?.event_type === 'price_change'
}
type PolymarketMarketPriceChangeMessage = PolymarketMarketMessage<'price_change'> & {
  timestamp: string
  price_changes: PolymarketMarketPriceChange[]
}

type PolymarketMarketPriceChange = {
  asset_id: string
  price: string
  size: string
  side: PolymarketMarketTradeSide
  hash: string
  best_bid: string
  best_ask: string
}

type PolymarketMarketLastTradePriceMessage = PolymarketMarketMessage<'last_trade_price'> & {
  asset_id: string
  fee_rate_bps: string
  price: string
  side: PolymarketMarketTradeSide
  size: string
  timestamp: string
  transaction_hash: string
}

type PolymarketMarketTradeSide = 'BUY' | 'SELL'

type PolymarketMarketTickSizeChangeMessage = PolymarketMarketMessage<'tick_size_change'> & {
  asset_id: string
  old_tick_size: string
  new_tick_size: string
  timestamp: string
}

type PolymarketMarketBestBidAskMessage = PolymarketMarketMessage<'best_bid_ask'> & {
  asset_id: string
  best_bid: string
  best_ask: string
  spread: string
  timestamp: string
}

type PolymarketMarketNewMarketMessage = PolymarketMarketMessage<'new_market'> & {
  id: string
  question: string
  slug: string
  description: string
  assets_ids: string[]
  outcomes: string[]
  event_message: PolymarketEventMessage
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
  fee_schedule?: PolymarketMarketFeeSchedule
}

type PolymarketEventMessage = {
  id: string
  ticker: string
  slug: string
  title: string
  description: string
}

type PolymarketMarketFeeSchedule = {
  exponent: string
  rate: string
  taker_only: boolean
  rebate_rate: string
}

type PolymarketMarketResolvedMessage = PolymarketMarketMessage<'market_resolved'> & {
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
