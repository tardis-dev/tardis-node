import { upperCaseSymbols } from '../handy'
import { BookChange, BookPriceLevel, DerivativeTicker, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

export class DydxTradesMapper implements Mapper<'dydx', Trade> {
  canHandle(message: DyDxTrade) {
    return message.channel === 'v3_trades' && message.type === 'channel_data'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'v3_trades',
        symbols
      } as const
    ]
  }

  *map(message: DyDxTrade, localTimestamp: Date): IterableIterator<Trade> {
    for (let trade of message.contents.trades) {
      yield {
        type: 'trade',
        symbol: message.id,
        exchange: 'dydx',
        id: undefined,
        price: Number(trade.price),
        amount: Number(trade.size),
        side: trade.side === 'SELL' ? 'sell' : 'buy',
        timestamp: trade.createdAt ? new Date(trade.createdAt) : localTimestamp,
        localTimestamp: localTimestamp
      }
    }
  }
}

export class DydxBookChangeMapper implements Mapper<'dydx', BookChange> {
  private _offsets: { [key: string]: { [key: string]: number | undefined } } = {}

  canHandle(message: DyDxOrderbookSnapshot | DyDxOrderBookUpdate) {
    return message.channel === 'v3_orderbook'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'v3_orderbook',
        symbols
      } as const
    ]
  }

  *map(message: DyDxOrderbookSnapshot | DyDxOrderBookUpdate, localTimestamp: Date): IterableIterator<BookChange> {
    if (message.type === 'subscribed') {
      this._offsets[message.id] = {}

      yield {
        type: 'book_change',
        symbol: message.id,
        exchange: 'dydx',
        isSnapshot: true,
        bids: message.contents.bids.map((bid) => {
          this._offsets[message.id][bid.price] = Number(bid.offset)
          return {
            price: Number(bid.price),
            amount: Number(bid.size)
          }
        }),

        asks: message.contents.asks.map((ask) => {
          this._offsets[message.id][ask.price] = Number(ask.offset)
          return {
            price: Number(ask.price),
            amount: Number(ask.size)
          }
        }),
        timestamp: localTimestamp,
        localTimestamp
      }
    } else {
      // https://docs.dydx.exchange/#orderbook
      const updateOffset = Number(message.contents.offset)

      const bookChange: BookChange = {
        type: 'book_change',
        symbol: message.id,
        exchange: 'dydx',
        isSnapshot: false,

        bids: message.contents.bids
          .map((bid) => {
            const lastPriceLevelOffset = this._offsets[message.id][bid[0]]
            if (lastPriceLevelOffset !== undefined && lastPriceLevelOffset >= updateOffset) {
              return
            }

            return {
              price: Number(bid[0]),
              amount: Number(bid[1])
            }
          })
          .filter((b) => b !== undefined) as BookPriceLevel[],

        asks: message.contents.asks
          .map((ask) => {
            const lastPriceLevelOffset = this._offsets[message.id][ask[0]]
            if (lastPriceLevelOffset !== undefined && lastPriceLevelOffset >= updateOffset) {
              return
            }

            return {
              price: Number(ask[0]),
              amount: Number(ask[1])
            }
          })
          .filter((b) => b !== undefined) as BookPriceLevel[],

        timestamp: localTimestamp,
        localTimestamp
      }

      for (const bid of message.contents.bids) {
        this._offsets[message.id][bid[0]] = updateOffset
      }

      for (const ask of message.contents.asks) {
        this._offsets[message.id][ask[0]] = updateOffset
      }

      if (bookChange.bids.length > 0 || bookChange.asks.length > 0) {
        yield bookChange
      }
    }
  }
}

export class DydxDerivativeTickerMapper implements Mapper<'dydx', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: DydxMarketsSnapshot | DyDxMarketsUpdate | DyDxTrade) {
    return message.channel === 'v3_markets' || (message.channel === 'v3_trades' && message.type === 'channel_data')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'v3_markets',
        symbols: [] as string[]
      } as const,
      {
        channel: 'v3_trades',
        symbols
      } as const
    ]
  }

  *map(message: DydxMarketsSnapshot | DyDxMarketsUpdate | DyDxTrade, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    if (message.channel === 'v3_trades') {
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.id, 'dydx')
      pendingTickerInfo.updateLastPrice(Number(message.contents.trades[message.contents.trades.length - 1].price))

      return
    }

    const contents = message.type === 'subscribed' ? message.contents.markets : message.contents

    for (const key in contents) {
      const marketInfo = contents[key]

      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(key, 'dydx')

      if (marketInfo.indexPrice !== undefined) {
        pendingTickerInfo.updateIndexPrice(Number(marketInfo.indexPrice))
      }
      if (marketInfo.oraclePrice !== undefined) {
        pendingTickerInfo.updateMarkPrice(Number(marketInfo.oraclePrice))
      }
      if (marketInfo.openInterest !== undefined) {
        pendingTickerInfo.updateOpenInterest(Number(marketInfo.openInterest))
      }

      if (marketInfo.nextFundingRate !== undefined) {
        pendingTickerInfo.updateFundingRate(Number(marketInfo.nextFundingRate))
      }

      if (marketInfo.nextFundingAt !== undefined) {
        pendingTickerInfo.updateFundingTimestamp(new Date(marketInfo.nextFundingAt))
      }

      pendingTickerInfo.updateTimestamp(localTimestamp)

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

type DyDxTrade = {
  type: 'channel_data'
  connection_id: 'e368fe1e-a007-44bd-9532-8eacc81a8bbc'
  message_id: 229
  id: 'BTC-USD'
  channel: 'v3_trades'
  contents: {
    trades: [{ size: '0.075'; side: 'SELL'; price: '57696'; createdAt: '2021-05-01T00:00:34.046Z' | undefined }]
  }
}

type DyDxOrderbookSnapshot = {
  type: 'subscribed'
  connection_id: '22be6448-1464-45ff-ae7d-1204eac64d0f'
  message_id: 1
  channel: 'v3_orderbook'
  id: '1INCH-USD'
  contents: {
    bids: [{ price: '5'; offset: '118546101'; size: '50' }]
    asks: [{ price: '7'; offset: '120842096'; size: '20' }]
  }
}

type DyDxOrderBookUpdate = {
  type: 'channel_data'
  connection_id: '22be6448-1464-45ff-ae7d-1204eac64d0f'
  message_id: 161
  id: '1INCH-USD'
  channel: 'v3_orderbook'
  contents: {
    offset: '125090042'
    bids: [string, string][]
    asks: [string, string][]
  }
}

type DydxMarketsSnapshot = {
  type: 'subscribed'
  connection_id: '8c11ee31-dbca-49fa-9df0-fc973948b7b5'
  message_id: 3
  channel: 'v3_markets'
  contents: {
    markets: {
      [key: string]: {
        market: 'BTC-USD'
        status: 'ONLINE'
        baseAsset: 'BTC'
        quoteAsset: 'USD'
        stepSize: '0.0001'
        tickSize: '1'
        indexPrice: '57794.7000'
        oraclePrice: '57880.5200'
        priceChange24H: '4257.9'
        nextFundingRate: '0.0000587260'
        nextFundingAt: '2021-05-01T00:00:00.000Z'
        minOrderSize: '0.001'
        type: 'PERPETUAL'
        initialMarginFraction: '0.04'
        maintenanceMarginFraction: '0.03'
        volume24H: '4710467.697100'
        trades24H: '663'
        openInterest: '101.2026'
        incrementalInitialMarginFraction: '0.01'
        incrementalPositionSize: '0.5'
        maxPositionSize: '30'
        baselinePositionSize: '1.0'
        allTimeLiquidationQuoteVolume: '3001153.615633'
        dailyLiquidationQuoteVolume: '6047.074828'
      }
    }
  }
}

type DyDxMarketsUpdate = {
  type: 'channel_data'
  connection_id: '8c11ee31-dbca-49fa-9df0-fc973948b7b5'
  message_id: 221
  channel: 'v3_markets'
  contents: {
    [key: string]: {
      market: 'BTC-USD'
      status: 'ONLINE'
      baseAsset: 'BTC'
      quoteAsset: 'USD'
      stepSize: '0.0001'
      tickSize: '1'
      indexPrice: '57794.7000'
      oraclePrice: '57880.5200'
      priceChange24H: '4257.9'
      nextFundingRate: '0.0000587260'
      nextFundingAt: '2021-05-01T00:00:00.000Z'
      minOrderSize: '0.001'
      type: 'PERPETUAL'
      initialMarginFraction: '0.04'
      maintenanceMarginFraction: '0.03'
      volume24H: '4710467.697100'
      trades24H: '663'
      openInterest: '101.2026'
      incrementalInitialMarginFraction: '0.01'
      incrementalPositionSize: '0.5'
      maxPositionSize: '30'
      baselinePositionSize: '1.0'
      allTimeLiquidationQuoteVolume: '3001153.615633'
      dailyLiquidationQuoteVolume: '6047.074828'
    }
  }
}
