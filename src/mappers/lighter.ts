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

type LighterOrderBookMessage = {
  type: 'subscribed/order_book' | 'update/order_book'
  channel: string
  last_updated_at: number
  offset: number
  timestamp: number
  order_book: {
    asks: LighterLevel[]
    bids: LighterLevel[]
    code: number
    nonce: number
    begin_nonce: number
    offset: number
    last_updated_at: number
  }
}

type LighterTrade = {
  trade_id: number
  trade_id_str?: string
  market_id: number
  size: string
  price: string
  is_maker_ask: boolean
  timestamp: number
  type: 'trade' | 'liquidation' | 'deleverage' | 'market-settlement'
}

type LighterUpdateTradeMessage = {
  type: 'update/trade'
  channel: string
  trades: LighterTrade[]
  liquidation_trades?: LighterTrade[]
}

type LighterMarketStatsEntry = {
  symbol?: string
  market_id: number
  mark_price?: string
  index_price?: string
  funding_rate?: string
  current_funding_rate?: string
  open_interest?: string
}

type LighterMarketStatsMessage = {
  type: 'update/market_stats'
  channel: string
  timestamp: number
  market_stats: { [marketIdOrSymbol: string]: LighterMarketStatsEntry }
}
