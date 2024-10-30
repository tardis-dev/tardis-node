import { upperCaseSymbols } from '../handy'
import { BookChange, DerivativeTicker, Liquidation, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

export class DydxV4TradesMapper implements Mapper<'dydx-v4', Trade> {
  canHandle(message: DyDxTrade) {
    return message.channel === 'v4_trades' && message.type === 'channel_data'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'v4_trades',
        symbols
      } as const
    ]
  }

  *map(message: DyDxTrade, localTimestamp: Date): IterableIterator<Trade> {
    for (let trade of message.contents.trades) {
      yield {
        type: 'trade',
        symbol: message.id,
        exchange: 'dydx-v4',
        id: trade.id,
        price: Number(trade.price),
        amount: Number(trade.size),
        side: trade.side === 'SELL' ? 'sell' : 'buy',
        timestamp: trade.createdAt ? new Date(trade.createdAt) : localTimestamp,
        localTimestamp: localTimestamp
      }
    }
  }
}

function mapSnapshotPriceLevel(level: { price: string; size: string }) {
  return {
    price: Number(level.price),
    amount: Number(level.size)
  }
}

function mapUpdatePriceLevel(level: [string, string]) {
  return {
    price: Number(level[0]),
    amount: Number(level[1])
  }
}
export class DydxV4BookChangeMapper implements Mapper<'dydx-v4', BookChange> {
  canHandle(message: DyDxOrderbookSnapshot | DyDxOrderBookUpdate) {
    return message.channel === 'v4_orderbook'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'v4_orderbook',
        symbols
      } as const
    ]
  }

  *map(message: DyDxOrderbookSnapshot | DyDxOrderBookUpdate, localTimestamp: Date): IterableIterator<BookChange> {
    if (message.type === 'subscribed') {
      yield {
        type: 'book_change',
        symbol: message.id,
        exchange: 'dydx-v4',
        isSnapshot: true,
        bids: message.contents.bids.map(mapSnapshotPriceLevel),
        asks: message.contents.asks.map(mapSnapshotPriceLevel),
        timestamp: localTimestamp,
        localTimestamp
      }
    } else {
      if (!message.contents) {
        return
      }

      const bookChange: BookChange = {
        type: 'book_change',
        symbol: message.id,
        exchange: 'dydx-v4',
        isSnapshot: false,
        bids: message.contents.bids !== undefined ? message.contents.bids.map(mapUpdatePriceLevel) : [],
        asks: message.contents.asks !== undefined ? message.contents.asks.map(mapUpdatePriceLevel) : [],
        timestamp: localTimestamp,
        localTimestamp
      }

      if (bookChange.bids.length > 0 || bookChange.asks.length > 0) {
        yield bookChange
      }
    }
  }
}

export class DydxV4DerivativeTickerMapper implements Mapper<'dydx-v4', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: DydxMarketsSnapshot | DyDxMarketsUpdate | DyDxTrade) {
    return message.channel === 'v4_markets' || (message.channel === 'v4_trades' && message.type === 'channel_data')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'v4_markets',
        symbols: [] as string[]
      } as const,
      {
        channel: 'v4_trades',
        symbols
      } as const
    ]
  }

  *map(message: DydxMarketsSnapshot | DyDxMarketsUpdate | DyDxTrade, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    if (message.channel === 'v4_trades') {
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.id, 'dydx-v4')
      pendingTickerInfo.updateLastPrice(Number(message.contents.trades[message.contents.trades.length - 1].price))

      return
    }
    if (message.type === 'subscribed' || (message.type === 'channel_data' && message.contents.trading !== undefined)) {
      const contents = message.type === 'subscribed' ? message.contents.markets : message.contents.trading
      for (const key in contents) {
        const marketInfo = (contents as any)[key] as DydxMarketsSnapshotContent | DydxMarketTradeUpdate

        const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(key, 'dydx-v4')

        if (marketInfo.oraclePrice !== undefined) {
          pendingTickerInfo.updateMarkPrice(Number(marketInfo.oraclePrice))
        }
        if (marketInfo.openInterest !== undefined) {
          pendingTickerInfo.updateOpenInterest(Number(marketInfo.openInterest))
        }

        if (marketInfo.nextFundingRate !== undefined) {
          pendingTickerInfo.updateFundingRate(Number(marketInfo.nextFundingRate))
        }

        pendingTickerInfo.updateTimestamp(localTimestamp)

        if (pendingTickerInfo.hasChanged()) {
          yield pendingTickerInfo.getSnapshot(localTimestamp)
        }
      }
    }

    if (message.type === 'channel_data' && message.contents.oraclePrices !== undefined) {
      for (const key in message.contents.oraclePrices) {
        const oraclePriceInfo = (message.contents.oraclePrices as any)[key] as OraclePriceInfo
        const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(key, 'dydx-v4')
        if (oraclePriceInfo.oraclePrice !== undefined) {
          pendingTickerInfo.updateMarkPrice(Number(oraclePriceInfo.oraclePrice))
        }
        pendingTickerInfo.updateTimestamp(localTimestamp)

        if (pendingTickerInfo.hasChanged()) {
          yield pendingTickerInfo.getSnapshot(localTimestamp)
        }
      }
    }
  }
}

export class DydxV4LiquidationsMapper implements Mapper<'dydx-v4', Liquidation> {
  canHandle(message: DyDxTrade) {
    return message.channel === 'v4_trades' && message.type === 'channel_data'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'v4_trades',
        symbols
      } as const
    ]
  }

  *map(message: DyDxTrade, localTimestamp: Date): IterableIterator<Liquidation> {
    for (let trade of message.contents.trades) {
      if (trade.type === 'LIQUIDATED') {
        yield {
          type: 'liquidation',
          symbol: message.id,
          exchange: 'dydx-v4',
          id: trade.id,
          price: Number(trade.price),
          amount: Number(trade.size),
          side: trade.side === 'SELL' ? 'sell' : 'buy',
          timestamp: trade.createdAt ? new Date(trade.createdAt) : localTimestamp,
          localTimestamp: localTimestamp
        }
      }
    }
  }
}

type DyDxTrade = {
  type: 'channel_data'
  connection_id: '3a2e4c0c-7579-4bf6-a570-e0979418bbe9'
  message_id: 15897
  id: 'BTC-USD'
  channel: 'v4_trades'
  version: '2.1.0'
  contents: {
    trades: [
      {
        id: '0165e6170000000200000002'
        size: '0.0001'
        price: '60392'
        side: 'BUY' | 'SELL'
        createdAt: '2024-08-23T00:00:57.627Z'
        type: 'LIMIT' | 'LIQUIDATED'
      }
    ]
  }
}

type DyDxOrderbookSnapshot = {
  type: 'subscribed'
  connection_id: '67838890-75de-4bf3-a638-d7bcdea5f245'
  message_id: 7
  channel: 'v4_orderbook'
  id: 'GRT-USD'
  contents: {
    bids: [{ price: '0.1547'; size: '35520' }]
    asks: [{ price: '0.155'; size: '3220' }]
  }
}

type DyDxOrderBookUpdate = {
  type: 'channel_data'
  connection_id: '00908030-4a70-43aa-9263-8ccdf57b5d40'
  message_id: 10290
  id: 'EOS-USD'
  channel: 'v4_orderbook'
  version: '1.0.0'
  contents: { bids: [['0.1003', '2017130']]; asks: undefined | [['0.1003', '2017130']] }
}

type DydxMarketsSnapshot = {
  type: 'subscribed'
  connection_id: '3a2e4c0c-7579-4bf6-a570-e0979418bbe9'
  message_id: 17
  channel: 'v4_markets'
  contents: {
    markets: {
      [key: string]: DydxMarketsSnapshotContent
    }
  }
}
type DydxMarketsSnapshotContent = {
  clobPairId: '0'
  ticker: 'BTC-USD'
  status: 'ACTIVE'
  oraclePrice: '60387.51779'
  priceChange24H: '-782.58326'
  volume24H: '247515340.0835'
  trades24H: 73556
  nextFundingRate: '0.00001351666666666667'
  initialMarginFraction: '0.05'
  maintenanceMarginFraction: '0.03'
  openInterest: '648.2389'
  atomicResolution: -10
  quantumConversionExponent: -9
  tickSize: '1'
  stepSize: '0.0001'
  stepBaseQuantums: 1000000
  subticksPerTick: 100000
  marketType: 'CROSS'
  openInterestLowerCap: '0'
  openInterestUpperCap: '0'
  baseOpenInterest: '648.4278'
}

type DyDxMarketsUpdate =
  | {
      type: 'channel_data'
      connection_id: '3a2e4c0c-7579-4bf6-a570-e0979418bbe9'
      message_id: 15871
      channel: 'v4_markets'
      version: '1.0.0'
      contents: {
        oraclePrices: undefined
        trading: {
          'ETH-USD': DydxMarketTradeUpdate
        }
      }
    }
  | {
      type: 'channel_data'
      connection_id: '3a2e4c0c-7579-4bf6-a570-e0979418bbe9'
      message_id: 50
      channel: 'v4_markets'
      version: '1.0.0'
      contents: {
        trading: undefined
        oraclePrices: {
          'ZERO-USD': OraclePriceInfo
        }
      }
    }

type OraclePriceInfo = { oraclePrice: string; effectiveAt: string; effectiveAtHeight: string; marketId: number }

type DydxMarketTradeUpdate = {
  id?: string
  clobPairId?: string
  ticker?: string
  marketId?: number
  oraclePrice: undefined
  baseAsset?: string
  quoteAsset?: string
  initialMarginFraction?: string
  maintenanceMarginFraction?: string
  basePositionSize?: string
  incrementalPositionSize?: string
  maxPositionSize?: string
  openInterest?: string
  quantumConversionExponent?: number
  atomicResolution?: number
  subticksPerTick?: number
  stepBaseQuantums?: number
  priceChange24H?: string
  volume24H?: string
  trades24H?: number
  nextFundingRate?: string
}
