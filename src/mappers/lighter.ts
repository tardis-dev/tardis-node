import { BookChange, DerivativeTicker, Trade } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'

function parseChannelMarketId(channel: string): string | undefined {
  const colonIndex = channel.indexOf(':')
  if (colonIndex < 0) {
    return undefined
  }
  const suffix = channel.slice(colonIndex + 1)
  if (suffix === 'all') {
    return undefined
  }
  return suffix
}

export class LighterTradesMapper implements Mapper<'lighter', Trade> {
  canHandle(message: LighterUpdateTradeMessage) {
    return message.type === 'update/trade'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'trade' as const,
        symbols
      }
    ]
  }

  *map(message: LighterUpdateTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    const symbol = parseChannelMarketId(message.channel)
    if (symbol === undefined) return

    for (const trade of message.trades) {
      yield {
        type: 'trade',
        symbol,
        exchange: 'lighter',
        id: trade.trade_id_str !== undefined ? trade.trade_id_str : String(trade.trade_id),
        price: Number(trade.price),
        amount: Number(trade.size),
        side: trade.is_maker_ask ? 'buy' : 'sell',
        timestamp: new Date(trade.timestamp),
        localTimestamp
      }
    }
  }
}

export class LighterBookChangeMapper implements Mapper<'lighter', BookChange> {
  private readonly _snapshotSent = new Set<string>()

  canHandle(message: LighterOrderBookMessage) {
    return message.type === 'update/order_book'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'order_book' as const,
        symbols
      }
    ]
  }

  *map(message: LighterOrderBookMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const symbol = parseChannelMarketId(message.channel)
    if (symbol === undefined) return

    const isSnapshot = this._snapshotSent.has(symbol) === false
    if (isSnapshot) {
      this._snapshotSent.add(symbol)
    }

    yield {
      type: 'book_change',
      symbol,
      exchange: 'lighter',
      isSnapshot,
      bids: message.order_book.bids.map(mapLighterLevel),
      asks: message.order_book.asks.map(mapLighterLevel),
      timestamp: new Date(message.timestamp),
      localTimestamp
    }
  }
}

function mapLighterLevel(level: LighterLevel) {
  return {
    price: Number(level.price),
    amount: Number(level.size)
  }
}

export class LighterDerivativeTickerMapper implements Mapper<'lighter', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: LighterMarketStatsMessage) {
    return message.type === 'update/market_stats'
  }

  getFilters(_symbols?: string[]) {
    return [
      {
        channel: 'market_stats' as const,
        symbols: undefined
      }
    ]
  }

  *map(message: LighterMarketStatsMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const stats = message.market_stats
    for (const key of Object.keys(stats)) {
      const entry = stats[key]
      const symbol = entry.symbol !== undefined ? entry.symbol : entry.market_id !== undefined ? String(entry.market_id) : key
      if (symbol === undefined) continue

      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(symbol, 'lighter')

      if (entry.mark_price !== undefined) pendingTickerInfo.updateMarkPrice(Number(entry.mark_price))
      if (entry.index_price !== undefined) pendingTickerInfo.updateIndexPrice(Number(entry.index_price))
      if (entry.funding_rate !== undefined) pendingTickerInfo.updateFundingRate(Number(entry.funding_rate))
      if (entry.open_interest !== undefined) pendingTickerInfo.updateOpenInterest(Number(entry.open_interest))

      if (pendingTickerInfo.hasChanged()) {
        pendingTickerInfo.updateTimestamp(new Date(message.timestamp))
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

type LighterLevel = {
  price: string
  size: string
}

type LighterOrderBook = {
  asks: LighterLevel[]
  bids: LighterLevel[]
  code: number
  nonce: number
  begin_nonce: number
  offset: number
  last_updated_at: number
}

type LighterOrderBookMessage = {
  type: 'subscribed/order_book' | 'update/order_book'
  channel: string
  last_updated_at: number
  offset: number
  timestamp: number
  order_book: LighterOrderBook
}

type LighterTrade = {
  trade_id: number
  trade_id_str: string
  tx_hash: string
  type: 'trade' | 'liquidation' | 'deleverage' | 'market-settlement'
  market_id: number
  size: string
  price: string
  usd_amount: string
  ask_id: number
  ask_id_str: string
  bid_id: number
  bid_id_str: string
  ask_client_id: number
  ask_client_id_str: string
  bid_client_id: number
  bid_client_id_str: string
  ask_account_id: number
  bid_account_id: number
  is_maker_ask: boolean
  block_height: number
  timestamp: number
  taker_fee?: number
  taker_position_size_before?: string
  taker_entry_quote_before?: string
  taker_initial_margin_fraction_before?: number
  taker_position_sign_changed?: boolean
  taker_allocated_margin_usdc_before?: number
  maker_fee?: number
  maker_position_size_before?: string
  maker_entry_quote_before?: string
  maker_initial_margin_fraction_before?: number
  maker_position_sign_changed?: boolean
  transaction_time: number
  ask_account_pnl?: string
  bid_account_pnl?: string
  side?: Trade['side']
}

type LighterTradeMessage = {
  type: 'subscribed/trade' | 'update/trade'
  channel: string
  nonce: number
  trades: LighterTrade[]
  liquidation_trades: LighterTrade[]
}

type LighterMarketStats = {
  symbol: string
  market_id: number
  index_price: string
  mark_price: string
  mid_price: string
  open_interest: string
  open_interest_limit: string
  funding_clamp_small: string
  funding_clamp_big: string
  last_trade_price: string
  current_funding_rate: string
  funding_rate: string
  funding_timestamp: number
  daily_base_token_volume: number
  daily_quote_token_volume: number
  daily_price_low: number
  daily_price_high: number
  daily_price_change: number
}

type LighterMarketStatsAllMessage = {
  type: 'subscribed/market_stats' | 'update/market_stats'
  channel: 'market_stats:all'
  timestamp: number
  market_stats: Record<string, LighterMarketStats>
}

type LighterMarketStatsMarketIdMessage = {
  type: 'subscribed/market_stats' | 'update/market_stats'
  channel: `market_stats:${number}`
  timestamp: number
  market_stats: LighterMarketStats
}

type LighterMarketStatsMessage = LighterMarketStatsAllMessage | LighterMarketStatsMarketIdMessage

type LighterSpotMarketStats = {
  symbol: string
  market_id: number
  index_price: string
  mid_price: string
  last_trade_price: string
  daily_base_token_volume: number
  daily_quote_token_volume: number
  daily_price_low: number
  daily_price_high: number
  daily_price_change: number
}

type LighterSpotMarketStatsAllMessage = {
  type: 'subscribed/spot_market_stats' | 'update/spot_market_stats'
  channel: 'spot_market_stats:all'
  timestamp: number
  spot_market_stats: Record<string, LighterSpotMarketStats>
}

type LighterSpotMarketStatsMarketIdMessage = {
  type: 'subscribed/spot_market_stats' | 'update/spot_market_stats'
  channel: `spot_market_stats:${number}`
  timestamp: number
  spot_market_stats: LighterSpotMarketStats
}

type LighterSpotMarketStatsMessage = LighterSpotMarketStatsAllMessage | LighterSpotMarketStatsMarketIdMessage
