import { asNumberIfValid, upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, DerivativeTicker, Exchange, Liquidation, OptionSummary, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// V5 Okex API mappers
// https://www.okex.com/docs-v5/en/#websocket-api-public-channel-trades-channel

export class OkexV5TradesMapper implements Mapper<OKEX_EXCHANGES, Trade> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: any) {
    if (message.event !== undefined || message.arg === undefined) {
      return false
    }
    return message.arg.channel === 'trades'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: `trades` as const,
        symbols
      }
    ]
  }

  *map(okexTradesMessage: OkexV5TradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const okexTrade of okexTradesMessage.data) {
      yield {
        type: 'trade',
        symbol: okexTrade.instId,
        exchange: this._exchange,
        id: okexTrade.tradeId,
        price: Number(okexTrade.px),
        amount: Number(okexTrade.sz),
        side: okexTrade.side === 'buy' ? 'buy' : 'sell',
        timestamp: new Date(Number(okexTrade.ts)),
        localTimestamp: localTimestamp
      }
    }
  }
}

const mapV5BookLevel = (level: OkexV5BookLevel) => {
  const price = Number(level[0])
  const amount = Number(level[1])

  return { price, amount }
}

export class OkexV5BookChangeMapper implements Mapper<OKEX_EXCHANGES, BookChange> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: any) {
    if (message.event !== undefined || message.arg === undefined) {
      return false
    }
    return message.arg.channel === 'books-l2-tbt'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: `books-l2-tbt` as const,
        symbols
      }
    ]
  }

  *map(okexDepthDataMessage: OkexV5BookMessage, localTimestamp: Date): IterableIterator<BookChange> {
    for (const message of okexDepthDataMessage.data) {
      if (okexDepthDataMessage.action === 'update' && message.bids.length === 0 && message.asks.length === 0) {
        continue
      }

      const timestamp = new Date(Number(message.ts))

      if (timestamp.valueOf() === 0) {
        continue
      }

      yield {
        type: 'book_change',
        symbol: okexDepthDataMessage.arg.instId,
        exchange: this._exchange,
        isSnapshot: okexDepthDataMessage.action === 'snapshot',
        bids: message.bids.map(mapV5BookLevel),
        asks: message.asks.map(mapV5BookLevel),
        timestamp,
        localTimestamp: localTimestamp
      }
    }
  }
}

export class OkexV5BookTickerMapper implements Mapper<OKEX_EXCHANGES, BookTicker> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: any) {
    if (message.event !== undefined || message.arg === undefined) {
      return false
    }
    return message.arg.channel === 'tickers'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: `tickers` as const,
        symbols
      }
    ]
  }

  *map(message: OkexV5TickerMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    for (const okexTicker of message.data) {
      const ticker: BookTicker = {
        type: 'book_ticker',
        symbol: okexTicker.instId,
        exchange: this._exchange,

        askAmount: asNumberIfValid(okexTicker.askSz),
        askPrice: asNumberIfValid(okexTicker.askPx),

        bidPrice: asNumberIfValid(okexTicker.bidPx),
        bidAmount: asNumberIfValid(okexTicker.bidSz),
        timestamp: new Date(Number(okexTicker.ts)),
        localTimestamp: localTimestamp
      }

      yield ticker
    }
  }
}

export class OkexV5DerivativeTickerMapper implements Mapper<'okex-futures' | 'okex-swap', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()
  private readonly _indexPrices = new Map<string, number>()

  private _futuresChannels = ['tickers', 'open-interest', 'mark-price', 'index-tickers'] as const

  private _swapChannels = ['tickers', 'open-interest', 'mark-price', 'index-tickers', 'funding-rate'] as const

  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: any) {
    const channels = this._exchange === 'okex-futures' ? this._futuresChannels : this._swapChannels

    if (message.event !== undefined || message.arg === undefined) {
      return false
    }

    return channels.includes(message.arg.channel)
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    const channels = this._exchange === 'okex-futures' ? this._futuresChannels : this._swapChannels
    return channels.map((channel) => {
      if (channel === 'index-tickers') {
        const indexes =
          symbols !== undefined
            ? symbols.map((s) => {
                const symbolParts = s.split('-')
                return `${symbolParts[0]}-${symbolParts[1]}`
              })
            : undefined
        return {
          channel,
          symbols: indexes
        }
      }

      return {
        channel,
        symbols
      }
    })
  }

  *map(
    message: OkexV5TickerMessage | OkexV5OpenInterestMessage | OkexV5MarkPriceMessage | OkexV5IndexTickerMessage | OkexV5FundingRateMessage,
    localTimestamp: Date
  ): IterableIterator<DerivativeTicker> {
    if (message.arg.channel === 'index-tickers') {
      for (const dataMessage of message.data) {
        const indexTickerMessage = dataMessage as OkexV5IndexTickerMessage['data'][0]

        const lastIndexPrice = Number(indexTickerMessage.idxPx)
        if (lastIndexPrice > 0) {
          this._indexPrices.set(indexTickerMessage.instId, lastIndexPrice)
        }
      }

      return
    }

    for (const dataMessage of message.data) {
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(dataMessage.instId, this._exchange)
      const symbolParts = dataMessage.instId.split('-')
      const indexSymbol = `${symbolParts[0]}-${symbolParts[1]}`

      const indexPrice = this._indexPrices.get(indexSymbol)

      if (indexPrice !== undefined) {
        pendingTickerInfo.updateIndexPrice(indexPrice)
      }

      if (message.arg.channel === 'mark-price') {
        const markPriceMessage = dataMessage as OkexV5MarkPriceMessage['data'][0]

        const markPrice = Number(markPriceMessage.markPx)
        if (markPrice > 0) {
          pendingTickerInfo.updateMarkPrice(markPrice)
          pendingTickerInfo.updateTimestamp(new Date(Number(markPriceMessage.ts)))
        }
      }

      if (message.arg.channel === 'open-interest') {
        const openInterestMessage = dataMessage as OkexV5OpenInterestMessage['data'][0]

        const openInterest = Number(openInterestMessage.oi)
        if (openInterest > 0) {
          pendingTickerInfo.updateOpenInterest(openInterest)
          pendingTickerInfo.updateTimestamp(new Date(Number(openInterestMessage.ts)))
        }
      }

      if (message.arg.channel === 'funding-rate') {
        const fundingRateMessage = dataMessage as OkexV5FundingRateMessage['data'][0]

        if (fundingRateMessage.fundingRate !== undefined) {
          pendingTickerInfo.updateFundingRate(Number(fundingRateMessage.fundingRate))
        }
        if (fundingRateMessage.fundingTime !== undefined) {
          pendingTickerInfo.updateFundingTimestamp(new Date(Number(fundingRateMessage.fundingTime)))
        }

        if (fundingRateMessage.nextFundingRate !== undefined) {
          pendingTickerInfo.updatePredictedFundingRate(Number(fundingRateMessage.nextFundingRate))
        }
      }

      if (message.arg.channel === 'tickers') {
        const tickerMessage = dataMessage as OkexV5TickerMessage['data'][0]

        const lastPrice = Number(tickerMessage.last)

        if (lastPrice > 0) {
          pendingTickerInfo.updateLastPrice(lastPrice)
          pendingTickerInfo.updateTimestamp(new Date(Number(tickerMessage.ts)))
        }
      }

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

export class OkexV5LiquidationsMapper implements Mapper<OKEX_EXCHANGES, Liquidation> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: any) {
    if (message.event !== undefined || message.arg === undefined) {
      return false
    }
    return message.arg.channel === 'liquidations'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'liquidations',
        symbols
      } as any
    ]
  }

  *map(okexLiquidationMessage: OkexV5LiquidationMessage, localTimestamp: Date): IterableIterator<Liquidation> {
    for (const okexLiquidation of okexLiquidationMessage.data) {
      const liquidation: Liquidation = {
        type: 'liquidation',
        symbol: okexLiquidationMessage.arg.instId,
        exchange: this._exchange,
        id: undefined,
        price: Number(okexLiquidation.bkPx),
        amount: Number(okexLiquidation.sz),
        side: okexLiquidation.side === 'buy' ? 'buy' : 'sell',
        timestamp: new Date(Number(okexLiquidation.ts)),
        localTimestamp: localTimestamp
      }
      yield liquidation
    }
  }
}

export class OkexV5OptionSummaryMapper implements Mapper<'okex-options', OptionSummary> {
  private readonly _indexPrices = new Map<string, number>()
  private readonly _openInterests = new Map<string, number>()
  private readonly _markPrices = new Map<string, number>()

  private readonly _tickers = new Map<string, OkexV5TickerMessage['data'][0]>()
  private readonly expiration_regex = /(\d{2})(\d{2})(\d{2})/

  canHandle(message: any) {
    if (message.event !== undefined || message.arg === undefined) {
      return false
    }
    return (
      message.arg.channel === 'opt-summary' ||
      message.arg.channel === 'index-tickers' ||
      message.arg.channel === 'tickers' ||
      message.arg.channel === 'open-interest' ||
      message.arg.channel === 'mark-price'
    )
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    const indexes =
      symbols !== undefined
        ? symbols.map((s) => {
            const symbolParts = s.split('-')
            return `${symbolParts[0]}-${symbolParts[1]}`
          })
        : undefined

    return [
      {
        channel: `opt-summary`,
        symbols: [] as string[]
      } as const,
      {
        channel: `index-tickers`,
        symbols: indexes
      } as const,
      {
        channel: `tickers`,
        symbols: symbols
      } as const,
      {
        channel: `open-interest`,
        symbols: symbols
      } as const,
      {
        channel: `mark-price`,
        symbols: symbols
      } as const
    ]
  }

  *map(
    message: OkexV5SummaryMessage | OkexV5IndexTickerMessage | OkexV5TickerMessage | OkexV5OpenInterestMessage | OkexV5MarkPriceMessage,
    localTimestamp: Date
  ): IterableIterator<OptionSummary> | undefined {
    if (message.arg.channel === 'index-tickers') {
      for (const dataMessage of message.data) {
        const indexTickerMessage = dataMessage as OkexV5IndexTickerMessage['data'][0]

        const lastIndexPrice = asNumberIfValid(indexTickerMessage.idxPx)
        if (lastIndexPrice !== undefined) {
          this._indexPrices.set(indexTickerMessage.instId, lastIndexPrice)
        }
      }
      return
    }

    if (message.arg.channel === 'open-interest') {
      for (const dataMessage of message.data) {
        const openInterestMessage = dataMessage as OkexV5OpenInterestMessage['data'][0]

        const openInterestValue = asNumberIfValid(openInterestMessage.oi)
        if (openInterestValue !== undefined) {
          this._openInterests.set(openInterestMessage.instId, openInterestValue)
        }
      }
      return
    }

    if (message.arg.channel === 'mark-price') {
      for (const dataMessage of message.data) {
        const markPriceMessage = dataMessage as OkexV5MarkPriceMessage['data'][0]

        const markPrice = asNumberIfValid(markPriceMessage.markPx)
        if (markPrice !== undefined) {
          this._markPrices.set(markPriceMessage.instId, markPrice)
        }
      }
      return
    }

    if (message.arg.channel === 'tickers') {
      for (const dataMessage of message.data) {
        const tickerMessage = dataMessage as OkexV5TickerMessage['data'][0]

        this._tickers.set(tickerMessage.instId, tickerMessage)
      }
      return
    }

    if (message.arg.channel === 'opt-summary') {
      for (const dataMessage of message.data) {
        const summary = dataMessage as OkexV5SummaryMessage['data'][0]

        const symbolParts = summary.instId.split('-')
        const isPut = symbolParts[4] === 'P'
        const strikePrice = Number(symbolParts[3])

        var dateArray = this.expiration_regex.exec(symbolParts[2])!

        const expirationDate = new Date(Date.UTC(+('20' + dateArray[1]), +dateArray[2] - 1, +dateArray[3], 8, 0, 0, 0))
        const lastUnderlyingPrice = this._indexPrices.get(summary.uly)

        const lastOpenInterest = this._openInterests.get(summary.instId)

        const lastMarkPrice = this._markPrices.get(summary.instId)

        const lastTickerInfo = this._tickers.get(summary.instId)

        const optionSummary: OptionSummary = {
          type: 'option_summary',
          symbol: summary.instId,
          exchange: 'okex-options',
          optionType: isPut ? 'put' : 'call',
          strikePrice,
          expirationDate,

          bestBidPrice: lastTickerInfo !== undefined ? asNumberIfValid(lastTickerInfo.bidPx) : undefined,
          bestBidAmount: lastTickerInfo !== undefined ? asNumberIfValid(lastTickerInfo.bidSz) : undefined,
          bestBidIV: asNumberIfValid(summary.bidVol),

          bestAskPrice: lastTickerInfo !== undefined ? asNumberIfValid(lastTickerInfo.askPx) : undefined,
          bestAskAmount: lastTickerInfo !== undefined ? asNumberIfValid(lastTickerInfo.askSz) : undefined,
          bestAskIV: asNumberIfValid(summary.askVol),

          lastPrice: lastTickerInfo !== undefined ? asNumberIfValid(lastTickerInfo.last) : undefined,
          openInterest: lastOpenInterest,

          markPrice: lastMarkPrice,
          markIV: asNumberIfValid(summary.markVol),

          delta: asNumberIfValid(summary.delta),
          gamma: asNumberIfValid(summary.gamma),
          vega: asNumberIfValid(summary.vega),
          theta: asNumberIfValid(summary.theta),
          rho: undefined,

          underlyingPrice: lastUnderlyingPrice,
          underlyingIndex: summary.uly,

          timestamp: new Date(Number(summary.ts)),
          localTimestamp: localTimestamp
        }

        yield optionSummary
      }
    }
  }
}

type OkexV5TradeMessage = {
  arg: { channel: 'trades'; instId: 'CRV-USDT' }
  data: [{ instId: 'CRV-USDT'; tradeId: '21300150'; px: '3.973'; sz: '13.491146'; side: 'buy'; ts: '1639999319938' }]
}

type OkexV5BookLevel = [string, string, string, string]

type OkexV5BookMessage =
  | {
      arg: { channel: 'books-l2-tbt'; instId: string }
      action: 'snapshot'
      data: [
        {
          asks: OkexV5BookLevel[]
          bids: OkexV5BookLevel[]
          ts: string
        }
      ]
    }
  | {
      arg: { channel: 'books-l2-tbt'; instId: string }
      action: 'update'
      data: [{ asks: OkexV5BookLevel[]; bids: OkexV5BookLevel[]; ts: string }]
    }

type OkexV5TickerMessage = {
  arg: { channel: 'tickers'; instId: string }
  data: [
    {
      instType: 'SPOT'
      instId: 'ACT-USDT'
      last: '0.00718'
      lastSz: '8052.117146'
      askPx: '0.0072'
      askSz: '54969.407534'
      bidPx: '0.00713'
      bidSz: '4092.326'
      open24h: '0.00717'
      high24h: '0.00722'
      low24h: '0.00696'
      sodUtc0: '0.00714'
      sodUtc8: '0.00721'
      volCcy24h: '278377.765301'
      vol24h: '39168761.49997'
      ts: '1639999318686'
    }
  ]
}

type OkexV5OpenInterestMessage = {
  arg: { channel: 'open-interest'; instId: string }
  data: [{ instId: 'FIL-USDT-220325'; instType: 'FUTURES'; oi: '236870'; oiCcy: '23687'; ts: '1640131202886' }]
}

type OkexV5MarkPriceMessage = {
  arg: { channel: 'mark-price'; instId: string }
  data: [{ instId: 'FIL-USDT-220325'; instType: 'FUTURES'; markPx: '36.232'; ts: '1640131204676' }]
}

type OkexV5IndexTickerMessage = {
  arg: { channel: 'index-tickers'; instId: string }
  data: [
    {
      instId: 'FIL-USDT'
      idxPx: '35.583'
      open24h: '34.558'
      high24h: '35.862'
      low24h: '34.529'
      sodUtc0: '35.309'
      sodUtc8: '34.83'
      ts: '1640140200581'
    }
  ]
}

type OkexV5FundingRateMessage = {
  arg: { channel: 'funding-rate'; instId: string }
  data: [
    { fundingRate: '0.00048105' | undefined; fundingTime: '1640131200000'; instId: string; instType: 'SWAP'; nextFundingRate: '0.00114' }
  ]
}

type OkexV5LiquidationMessage = {
  arg: { channel: 'liquidations'; instId: 'BTC-USDT-211231'; generated: true }
  data: [{ bkLoss: '0'; bkPx: '49674.2'; ccy: ''; posSide: 'short'; side: 'buy'; sz: '40'; ts: '1640140211925' }]
}

type OkexV5SummaryMessage = {
  arg: { channel: 'opt-summary'; uly: 'ETH-USD' }
  data: [
    {
      instType: 'OPTION'
      instId: 'ETH-USD-211222-4000-C'
      uly: 'ETH-USD'
      delta: '0.1975745164'
      gamma: '4.7290833601'
      vega: '0.0002005415'
      theta: '-0.004262964'
      lever: '162.472613953'
      markVol: '0.7794507758'
      bidVol: '0.7421960156'
      askVol: '0.8203208593'
      realVol: ''
      deltaBS: '0.2038286081'
      gammaBS: '0.0013437829'
      thetaBS: '-16.4798150221'
      vegaBS: '0.7647227087'
      ts: '1640001659301'
    }
  ]
}

//---
//V3 Okex API mappers
// https://www.okex.com/docs/en/#ws_swap-README

export class OkexTradesMapper implements Mapper<OKEX_EXCHANGES, Trade> {
  constructor(private readonly _exchange: Exchange, private readonly _market: OKEX_MARKETS) {}

  canHandle(message: OkexDataMessage) {
    return message.table === `${this._market}/trade`
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: `${this._market}/trade` as const,
        symbols
      }
    ]
  }

  *map(okexTradesMessage: OKexTradesDataMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const okexTrade of okexTradesMessage.data) {
      const symbol = okexTrade.instrument_id

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
    symbols = upperCaseSymbols(symbols)

    if (this._canUseTickByTickChannel) {
      return [
        {
          channel: `${this._market}/depth_l2_tbt` as const,
          symbols
        }
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
    symbols = upperCaseSymbols(symbols)

    const channels = this._exchange === 'okex-futures' ? this._futuresChannels : this._swapChannels
    return channels.map((channel) => {
      return {
        channel,
        symbols
      } as any
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

export class OkexOptionSummaryMapper implements Mapper<'okex-options', OptionSummary> {
  private readonly _indexPrices = new Map<string, number>()
  private readonly expiration_regex = /(\d{2})(\d{2})(\d{2})/

  canHandle(message: OkexDataMessage) {
    return message.table === 'index/ticker' || message.table === 'option/summary'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

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
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: `${this._market}/liquidation`,
        symbols
      } as any
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

export class OkexBookTickerMapper implements Mapper<OKEX_EXCHANGES, BookTicker> {
  constructor(private readonly _exchange: Exchange, private readonly _market: OKEX_MARKETS) {}

  canHandle(message: OkexDataMessage) {
    return message.table === `${this._market}/ticker`
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: `${this._market}/ticker`,
        symbols
      } as any
    ]
  }

  *map(message: OkexTickersMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    for (const okexTicker of message.data) {
      const ticker: BookTicker = {
        type: 'book_ticker',
        symbol: okexTicker.instrument_id,
        exchange: this._exchange,

        askAmount: asNumberIfValid(okexTicker.best_ask_size),
        askPrice: asNumberIfValid(okexTicker.best_ask),

        bidPrice: asNumberIfValid(okexTicker.best_bid),
        bidAmount: asNumberIfValid(okexTicker.best_bid_size),
        timestamp: new Date(okexTicker.timestamp),
        localTimestamp: localTimestamp
      }

      yield ticker
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
    best_bid_size: string | undefined
    best_ask_size: string | undefined
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
