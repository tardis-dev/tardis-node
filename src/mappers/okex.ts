import { BookChange, DerivativeTicker, Exchange, Trade, OptionSummary, Liquidation } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://www.okex.com/docs/en/#ws_swap-README

export class OkexTradesMapper implements Mapper<OKEX_EXCHANGES, Trade> {
  private readonly _seenSymbols = new Set<string>()

  constructor(private readonly _exchange: Exchange, private readonly _market: OKEX_MARKETS) {}

  canHandle(message: OkexDataMessage) {
    return message.table === `${this._market}/trade`
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: `${this._market}/trade`,
        symbols
      }
    ]
  }

  *map(okexTradesMessage: OKexTradesDataMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const okexTrade of okexTradesMessage.data) {
      const symbol = okexTrade.instrument_id

      // always ignore first returned trade as it's a 'stale' trade, which has already been published before disconnect
      if (this._seenSymbols.has(symbol) === false) {
        this._seenSymbols.add(symbol)
        break
      }

      yield {
        type: 'trade',
        symbol,
        exchange: this._exchange,
        id: typeof okexTrade.trade_id === 'string' ? okexTrade.trade_id : undefined,
        price: Number(okexTrade.price),
        amount: okexTrade.qty !== undefined ? Number(okexTrade.qty) : Number(okexTrade.size),
        side: okexTrade.side,
        timestamp: new Date(okexTrade.timestamp),
        localTimestamp: localTimestamp
      }
    }
  }
}

const mapBookLevel = (level: OkexBookLevel) => {
  const price = Number(level[0])
  const amount = Number(level[1])

  return { price, amount }
}

export class OkexBookChangeMapper implements Mapper<OKEX_EXCHANGES, BookChange> {
  constructor(
    private readonly _exchange: Exchange,
    private readonly _market: OKEX_MARKETS,
    private readonly _canUseTickByTickChannel: boolean
  ) {}

  canHandle(message: OkexDataMessage) {
    const channelSuffix = this._canUseTickByTickChannel ? 'depth_l2_tbt' : 'depth'

    return message.table === `${this._market}/${channelSuffix}`
  }

  getFilters(symbols?: string[]) {
    if (this._canUseTickByTickChannel) {
      return [
        {
          channel: `${this._market}/depth_l2_tbt`,
          symbols
        } as const
      ]
    }

    // subscribe to both book channels and in canHandle decide which one to use
    // as one can subscribe to date range period that overlaps both when only depth channel has been available
    // and when both were available (both depth and depth_l2_tbt)
    return [
      {
        channel: `${this._market}/depth_l2_tbt`,
        symbols
      } as const,
      {
        channel: `${this._market}/depth`,
        symbols
      } as const
    ]
  }

  *map(okexDepthDataMessage: OkexDepthDataMessage, localTimestamp: Date): IterableIterator<BookChange> {
    for (const message of okexDepthDataMessage.data) {
      if (message.bids.length === 0 && message.asks.length === 0) {
        continue
      }

      const timestamp = new Date(message.timestamp)

      if (timestamp.valueOf() === 0) {
        continue
      }

      yield {
        type: 'book_change',
        symbol: message.instrument_id,
        exchange: this._exchange,
        isSnapshot: okexDepthDataMessage.action === 'partial',
        bids: message.bids.map(mapBookLevel),
        asks: message.asks.map(mapBookLevel),
        timestamp,
        localTimestamp: localTimestamp
      }
    }
  }
}

export class OkexDerivativeTickerMapper implements Mapper<'okex-futures' | 'okex-swap', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()
  private _futuresChannels = ['futures/ticker', 'futures/mark_price']
  private _swapChannels = ['swap/ticker', 'swap/mark_price', 'swap/funding_rate']

  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: OkexDataMessage) {
    const channels = this._exchange === 'okex-futures' ? this._futuresChannels : this._swapChannels

    return channels.includes(message.table)
  }

  getFilters(symbols?: string[]) {
    const channels = this._exchange === 'okex-futures' ? this._futuresChannels : this._swapChannels
    return channels.map((channel) => {
      return {
        channel,
        symbols
      }
    })
  }

  *map(
    message: OkexTickersMessage | OkexFundingRateMessage | OkexMarkPriceMessage,
    localTimestamp: Date
  ): IterableIterator<DerivativeTicker> {
    for (const okexMessage of message.data) {
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(okexMessage.instrument_id, this._exchange)
      if ('funding_rate' in okexMessage) {
        pendingTickerInfo.updateFundingRate(Number(okexMessage.funding_rate))
        pendingTickerInfo.updateFundingTimestamp(new Date(okexMessage.funding_time))
        if (okexMessage.estimated_rate !== undefined) {
          pendingTickerInfo.updatePredictedFundingRate(Number(okexMessage.estimated_rate))
        }
      }

      if ('mark_price' in okexMessage) {
        pendingTickerInfo.updateMarkPrice(Number(okexMessage.mark_price))
      }
      if ('open_interest' in okexMessage) {
        const openInterest = Number(okexMessage.open_interest)
        if (openInterest > 0) {
          pendingTickerInfo.updateOpenInterest(Number(okexMessage.open_interest))
        }
      }
      if ('last' in okexMessage) {
        pendingTickerInfo.updateLastPrice(Number(okexMessage.last))
      }

      if (okexMessage.timestamp !== undefined) {
        pendingTickerInfo.updateTimestamp(new Date(okexMessage.timestamp))
      }

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

function asNumberIfValid(val: string | undefined | null) {
  if (val === undefined || val === null) {
    return
  }

  var asNumber = Number(val)

  if (isNaN(asNumber) || isFinite(asNumber) === false) {
    return
  }

  if (asNumber === 0) {
    return
  }

  return asNumber
}

export class OkexOptionSummaryMapper implements Mapper<'okex-options', OptionSummary> {
  private readonly _indexPrices = new Map<string, number>()
  private readonly expiration_regex = /(\d{2})(\d{2})(\d{2})/

  canHandle(message: OkexDataMessage) {
    return message.table === 'index/ticker' || message.table === 'option/summary'
  }

  getFilters(symbols?: string[]) {
    const indexes =
      symbols !== undefined
        ? symbols.map((s) => {
            const symbolParts = s.split('-')
            return `${symbolParts[0]}-${symbolParts[1]}`
          })
        : undefined

    return [
      {
        channel: `option/summary`,
        symbols
      } as const,
      {
        channel: `index/ticker`,
        symbols: indexes
      } as const
    ]
  }

  *map(message: OkexOptionSummaryData | OkexIndexData, localTimestamp: Date): IterableIterator<OptionSummary> | undefined {
    if (message.table === 'index/ticker') {
      for (const index of message.data) {
        const lastIndexPrice = Number(index.last)
        if (lastIndexPrice > 0) {
          this._indexPrices.set(index.instrument_id, lastIndexPrice)
        }
      }
      return
    }

    for (const summary of message.data) {
      const symbolParts = summary.instrument_id.split('-')
      const isPut = symbolParts[4] === 'P'
      const strikePrice = Number(symbolParts[3])

      var dateArray = this.expiration_regex.exec(symbolParts[2])!

      const expirationDate = new Date(Date.UTC(+('20' + dateArray[1]), +dateArray[2] - 1, +dateArray[3], 8, 0, 0, 0))
      const lastUnderlyingPrice = this._indexPrices.get(summary.underlying)

      const optionSummary: OptionSummary = {
        type: 'option_summary',
        symbol: summary.instrument_id,
        exchange: 'okex-options',
        optionType: isPut ? 'put' : 'call',
        strikePrice,
        expirationDate,

        bestBidPrice: asNumberIfValid(summary.best_bid),
        bestBidAmount: asNumberIfValid(summary.best_bid_size),
        bestBidIV: asNumberIfValid(summary.bid_vol),

        bestAskPrice: asNumberIfValid(summary.best_ask),
        bestAskAmount: asNumberIfValid(summary.best_ask_size),
        bestAskIV: asNumberIfValid(summary.ask_vol),

        lastPrice: asNumberIfValid(summary.last),
        openInterest: asNumberIfValid(summary.open_interest),

        markPrice: asNumberIfValid(summary.mark_price),
        markIV: asNumberIfValid(summary.mark_vol),

        delta: asNumberIfValid(summary.delta),
        gamma: asNumberIfValid(summary.gamma),
        vega: asNumberIfValid(summary.vega),
        theta: asNumberIfValid(summary.theta),
        rho: undefined,

        underlyingPrice: lastUnderlyingPrice,
        underlyingIndex: summary.underlying,

        timestamp: new Date(summary.timestamp),
        localTimestamp: localTimestamp
      }

      yield optionSummary
    }
  }
}

export class OkexLiquidationsMapper implements Mapper<OKEX_EXCHANGES, Liquidation> {
  constructor(private readonly _exchange: Exchange, private readonly _market: OKEX_MARKETS) {}

  canHandle(message: OkexDataMessage) {
    return message.table === `${this._market}/liquidation`
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: `${this._market}/liquidation`,
        symbols
      }
    ]
  }

  *map(okexLiquidationDataMessage: OkexLiqudationDataMessage, localTimestamp: Date): IterableIterator<Liquidation> {
    for (const okexLiquidation of okexLiquidationDataMessage.data) {
      const liquidation: Liquidation = {
        type: 'liquidation',
        symbol: okexLiquidation.instrument_id,
        exchange: this._exchange,
        id: undefined,
        price: Number(okexLiquidation.price),
        amount: Number(okexLiquidation.size),
        side: okexLiquidation.type === '3' ? 'sell' : 'buy',
        timestamp: new Date(okexLiquidation.created_at),
        localTimestamp: localTimestamp
      }
      yield liquidation
    }
  }
}

type OkexDataMessage = {
  table: string
}

type OKexTradesDataMessage = {
  data: {
    side: 'buy' | 'sell'
    trade_id: string | number
    price: string | number
    qty?: string | number
    size?: string | number
    instrument_id: string
    timestamp: string
  }[]
}

type OkexLiqudationDataMessage = {
  data: {
    loss: string
    size: string
    price: string
    created_at: string
    type: string
    instrument_id: string
  }[]
}

type OkexTickersMessage = {
  data: {
    last: string | number
    best_bid: string | number
    best_ask: string | number
    open_interest: string | undefined
    instrument_id: string
    timestamp: string
  }[]
}

type OkexFundingRateMessage = {
  data: {
    funding_rate: string
    funding_time: string
    estimated_rate?: string
    instrument_id: string
    timestamp: undefined
  }[]
}

type OkexMarkPriceMessage = {
  data: {
    instrument_id: string
    mark_price: string
    timestamp: string
  }[]
}

type OkexDepthDataMessage = {
  action: 'partial' | 'update'
  data: {
    instrument_id: string
    asks: OkexBookLevel[]
    bids: OkexBookLevel[]
    timestamp: string
  }[]
}

type OkexBookLevel = [number | string, number | string, number | string, number | string]

type OKEX_EXCHANGES = 'okex' | 'okcoin' | 'okex-futures' | 'okex-swap' | 'okex-options'

type OKEX_MARKETS = 'spot' | 'swap' | 'futures' | 'option'

type OkexIndexData = {
  table: 'index/ticker'
  data: [
    {
      last: number
      instrument_id: string
    }
  ]
}

type OkexOptionSummaryData = {
  table: 'option/summary'
  data: [
    {
      instrument_id: string
      underlying: string
      best_ask: string
      best_bid: string
      best_ask_size: string
      best_bid_size: string
      change_rate: string
      delta: string
      gamma: string
      bid_vol: string
      ask_vol: string
      mark_vol: string
      last: string
      leverage: string
      mark_price: string
      theta: string
      vega: string
      open_interest: string
      timestamp: string
    }
  ]
}
