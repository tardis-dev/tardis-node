import { BookChange, BookTicker, Trade } from '../types.ts'
import { asNumberOrUndefined } from '../handy.ts'
import { Mapper } from './mapper.ts'

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

type PolymarketMarketBookMessage = PolymarketMarketMessage<'book'> & {
  asset_id: string
  timestamp: string
  hash: string
  bids: PolymarketMarketBookLevel[]
  asks: PolymarketMarketBookLevel[]
  tick_size?: string
}

type PolymarketMarketBookLevel = {
  price: string
  size: string
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

