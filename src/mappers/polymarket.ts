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
  bids: PolymarketLevel[]
  asks: PolymarketLevel[]
  tick_size?: string
}

type PolymarketLevel = {
  price: string
  size: string
}
