import { asNonZeroNumberOrUndefined } from '../handy.ts'
import { BookChange, BookTicker, DerivativeTicker, Liquidation, Trade } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'
import { exchangeMappers } from './registry.ts'

export const lighterMappers = exchangeMappers({
  lighter: createLighterMappers('lighter'),
  'lighter-rh': createLighterMappers('lighter-rh')
})

type LighterExchange = 'lighter' | 'lighter-rh'

function createLighterMappers<T extends LighterExchange>(exchange: T) {
  return {
    trades: () => new LighterTradesMapper(exchange),
    bookChanges: () => new LighterBookChangeMapper(exchange),
    derivativeTickers: () => new LighterDerivativeTickerMapper(exchange),
    liquidations: () => new LighterLiquidationMapper(exchange),
    bookTickers: () => new LighterBookTickerMapper(exchange)
  }
}

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

class LighterTradesMapper<T extends LighterExchange> implements Mapper<T, Trade> {
  constructor(private readonly exchange: T) {}

  canHandle(message: LighterTradeMessage) {
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

  *map(message: LighterTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const trade of message.trades) {
      yield {
        type: 'trade',
        symbol: trade.market_id.toString(),
        exchange: this.exchange,
        id: trade.trade_id_str,
        price: Number(trade.price),
        amount: Number(trade.size),
        side: trade.is_maker_ask ? 'buy' : 'sell',
        timestamp: new Date(trade.timestamp),
        localTimestamp
      }
    }
  }
}

class LighterLiquidationMapper<T extends LighterExchange> implements Mapper<T, Liquidation> {
  constructor(private readonly exchange: T) {}

  canHandle(message: LighterTradeMessage) {
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

  *map(message: LighterTradeMessage, localTimestamp: Date): IterableIterator<Liquidation> {
    if (!Array.isArray(message.liquidation_trades)) {
      return
    }

    for (const trade of message.liquidation_trades) {
      if (trade.type !== 'liquidation') {
        continue
      }

      yield {
        type: 'liquidation',
        symbol: trade.market_id.toString(),
        exchange: this.exchange,
        id: trade.trade_id_str,
        price: Number(trade.price),
        amount: Number(trade.size),
        side: trade.is_maker_ask ? 'buy' : 'sell',
        timestamp: new Date(trade.timestamp),
        localTimestamp
      }
    }
  }
}

class LighterBookChangeMapper<T extends LighterExchange> implements Mapper<T, BookChange> {
  constructor(private readonly exchange: T) {}

  canHandle(message: LighterOrderBookMessage) {
    return message.type === 'subscribed/order_book' || message.type === 'update/order_book'
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

    yield {
      type: 'book_change',
      symbol,
      exchange: this.exchange,
      isSnapshot: message.type === 'subscribed/order_book',
      bids: message.order_book.bids.map(this.mapLevel),
      asks: message.order_book.asks.map(this.mapLevel),
      timestamp: new Date(message.timestamp),
      localTimestamp
    }
  }

  private mapLevel(level: LighterLevel) {
    return {
      price: Number(level.price),
      amount: Number(level.size)
    }
  }
}

class LighterBookTickerMapper<T extends LighterExchange> implements Mapper<T, BookTicker> {
  constructor(private readonly exchange: T) {}

  canHandle(message: LighterTickerMessage) {
    return message.type === 'update/ticker'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'ticker' as const,
        symbols
      }
    ]
  }

  *map(message: LighterTickerMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    const symbol = parseChannelMarketId(message.channel)
    if (symbol === undefined) return

    yield {
      type: 'book_ticker',
      symbol,
      exchange: this.exchange,
      askAmount: asNonZeroNumberOrUndefined(message.ticker?.a?.size),
      askPrice: asNonZeroNumberOrUndefined(message.ticker?.a?.price),
      bidPrice: asNonZeroNumberOrUndefined(message.ticker?.b?.price),
      bidAmount: asNonZeroNumberOrUndefined(message.ticker?.b?.size),
      timestamp: new Date(message.timestamp),
      localTimestamp
    }
  }
}

class LighterDerivativeTickerMapper<T extends LighterExchange> implements Mapper<T, DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  constructor(private readonly exchange: T) {}

  canHandle(message: LighterMarketStatsMessage) {
    return message.type === 'update/market_stats'
  }

  getFilters(_symbols?: string[]) {
    return [
      {
        channel: 'market_stats' as const,
        symbols: []
      }
    ]
  }

  *map(message: LighterMarketStatsMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    for (const entry of this.iterateMarketStats(message)) {
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(entry.market_id.toString(), this.exchange)

      pendingTickerInfo.updateMarkPrice(Number(entry.mark_price))
      pendingTickerInfo.updateIndexPrice(Number(entry.index_price))
      pendingTickerInfo.updateFundingRate(Number(entry.current_funding_rate))
      pendingTickerInfo.updateLastPrice(Number(entry.last_trade_price))
      pendingTickerInfo.updateOpenInterest(Number(entry.open_interest))

      if (pendingTickerInfo.hasChanged()) {
        pendingTickerInfo.updateTimestamp(new Date(message.timestamp))
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }

  private *iterateMarketStats(message: LighterMarketStatsMessage): IterableIterator<LighterMarketStats> {
    if (message.channel === 'market_stats:all') {
      for (const key of Object.keys(message.market_stats)) {
        yield message.market_stats[key]
      }
      return
    }

    yield message.market_stats
  }
}

export type LighterLevel = {
  price: string
  size: string
}

export type LighterOrderBook = {
  asks: LighterLevel[]
  bids: LighterLevel[]
  code: number
  nonce: number
  begin_nonce: number
  offset: number
  last_updated_at: number
}

export type LighterOrderBookMessage = {
  type: 'subscribed/order_book' | 'update/order_book'
  channel: `order_book:${number}`
  last_updated_at: number
  offset: number
  timestamp: number
  order_book: LighterOrderBook
}

export type LighterTicker = {
  s: string
  a?: Partial<LighterLevel>
  b?: Partial<LighterLevel>
  last_updated_at: number
}

export type LighterTickerMessage = {
  type: 'subscribed/ticker' | 'update/ticker'
  channel: `ticker:${number}`
  last_updated_at: number
  nonce: number
  ticker: LighterTicker
  timestamp: number
}

export type LighterTrade = {
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
  taker_allocated_margin_usdc_after?: number
  maker_fee?: number
  maker_position_size_before?: string
  maker_entry_quote_before?: string
  maker_initial_margin_fraction_before?: number
  maker_position_sign_changed?: boolean
  maker_allocated_margin_usdc_before?: number
  maker_allocated_margin_usdc_after?: number
  transaction_time: number
  ask_account_pnl?: string
  bid_account_pnl?: string
  integrator_taker_fee?: number
  integrator_taker_fee_collector_index?: number
  integrator_maker_fee?: number
  integrator_maker_fee_collector_index?: number
  ask_order_version?: number
  bid_order_version?: number
}

export type LighterTradeMessage = {
  type: 'subscribed/trade' | 'update/trade'
  channel: `trade:${number}`
  nonce: number
  trades: LighterTrade[]
  liquidation_trades?: LighterTrade[]
}

export type LighterMarketStats = {
  symbol: string
  market_id: number
  index_price: string
  mark_price: string
  mid_price: string
  best_ask_price: string
  best_bid_price: string
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
  base_interest_rate: string
  premium?: string
}

export type LighterMarketStatsAllMessage = {
  type: 'subscribed/market_stats' | 'update/market_stats'
  channel: 'market_stats:all'
  timestamp: number
  market_stats: Record<string, LighterMarketStats>
}

export type LighterMarketStatsMarketIdMessage = {
  type: 'subscribed/market_stats' | 'update/market_stats'
  channel: `market_stats:${number}`
  timestamp: number
  market_stats: LighterMarketStats
}

export type LighterMarketStatsMessage = LighterMarketStatsAllMessage | LighterMarketStatsMarketIdMessage

export type LighterSpotMarketStats = {
  symbol: string
  market_id: number
  index_price: string
  mid_price: string
  best_ask_price: string
  best_bid_price: string
  last_trade_price: string
  daily_base_token_volume: number
  daily_quote_token_volume: number
  daily_price_low: number
  daily_price_high: number
  daily_price_change: number
}

export type LighterSpotMarketStatsAllMessage = {
  type: 'subscribed/spot_market_stats' | 'update/spot_market_stats'
  channel: 'spot_market_stats:all'
  timestamp: number
  spot_market_stats: Record<string, LighterSpotMarketStats>
}

export type LighterSpotMarketStatsMarketIdMessage = {
  type: 'subscribed/spot_market_stats' | 'update/spot_market_stats'
  channel: `spot_market_stats:${number}`
  timestamp: number
  spot_market_stats: LighterSpotMarketStats
}

export type LighterSpotMarketStatsMessage = LighterSpotMarketStatsAllMessage | LighterSpotMarketStatsMarketIdMessage
