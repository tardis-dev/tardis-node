import { asNumberIfValid, CircularBuffer, upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, DerivativeTicker, Exchange, FilterForExchange, Liquidation, OptionSummary, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://huobiapi.github.io/docs/spot/v1/en/#websocket-market-data
// https://github.com/huobiapi/API_Docs_en/wiki/WS_api_reference_en

export class HuobiTradesMapper
  implements Mapper<'huobi' | 'huobi-dm' | 'huobi-dm-swap' | 'huobi-dm-linear-swap' | 'huobi-dm-options', Trade>
{
  constructor(private readonly _exchange: Exchange) {}
  canHandle(message: HuobiDataMessage) {
    if (message.ch === undefined) {
      return false
    }
    return message.ch.endsWith('.trade.detail')
  }

  getFilters(symbols?: string[]) {
    symbols = normalizeSymbols(symbols)

    return [
      {
        channel: 'trade',
        symbols
      } as const
    ]
  }

  *map(message: HuobiTradeDataMessage, localTimestamp: Date): IterableIterator<Trade> {
    const symbol = message.ch.split('.')[1].toUpperCase()

    for (const huobiTrade of message.tick.data) {
      yield {
        type: 'trade',
        symbol,
        exchange: this._exchange,
        id: String(huobiTrade.tradeId !== undefined ? huobiTrade.tradeId : huobiTrade.id),
        price: huobiTrade.price,
        amount: huobiTrade.amount,
        side: huobiTrade.direction,
        timestamp: new Date(huobiTrade.ts),
        localTimestamp: localTimestamp
      }
    }
  }
}

export class HuobiBookChangeMapper
  implements Mapper<'huobi' | 'huobi-dm' | 'huobi-dm-swap' | 'huobi-dm-linear-swap' | 'huobi-dm-options', BookChange>
{
  constructor(protected readonly _exchange: Exchange) {}

  canHandle(message: HuobiDataMessage) {
    if (message.ch === undefined) {
      return false
    }

    return message.ch.includes('.depth.')
  }

  getFilters(symbols?: string[]) {
    symbols = normalizeSymbols(symbols)

    return [
      {
        channel: 'depth',
        symbols
      } as const
    ]
  }

  *map(message: HuobiDepthDataMessage, localTimestamp: Date) {
    const symbol = message.ch.split('.')[1].toUpperCase()
    const isSnapshot = 'event' in message.tick ? message.tick.event === 'snapshot' : 'update' in message ? false : true
    const data = message.tick
    const bids = Array.isArray(data.bids) ? data.bids : []
    const asks = Array.isArray(data.asks) ? data.asks : []
    if (bids.length === 0 && asks.length === 0) {
      return
    }

    yield {
      type: 'book_change',
      symbol,
      exchange: this._exchange,
      isSnapshot,
      bids: bids.map(this._mapBookLevel),
      asks: asks.map(this._mapBookLevel),
      timestamp: new Date(message.ts),
      localTimestamp: localTimestamp
    } as const
  }

  private _mapBookLevel(level: HuobiBookLevel) {
    return { price: level[0], amount: level[1] }
  }
}

function isSnapshot(message: HuobiMBPDataMessage | HuobiMBPSnapshot): message is HuobiMBPSnapshot {
  return 'rep' in message
}

export class HuobiMBPBookChangeMapper implements Mapper<'huobi', BookChange> {
  protected readonly symbolToMBPInfoMapping: {
    [key: string]: MBPInfo
  } = {}

  constructor(protected readonly _exchange: Exchange) {}

  canHandle(message: any) {
    const channel = message.ch || message.rep
    if (channel === undefined) {
      return false
    }

    return channel.includes('.mbp.')
  }

  getFilters(symbols?: string[]) {
    symbols = normalizeSymbols(symbols)

    return [
      {
        channel: 'mbp',
        symbols
      } as const
    ]
  }

  *map(message: HuobiMBPDataMessage | HuobiMBPSnapshot, localTimestamp: Date) {
    const symbol = (isSnapshot(message) ? message.rep : message.ch).split('.')[1].toUpperCase()

    if (this.symbolToMBPInfoMapping[symbol] === undefined) {
      this.symbolToMBPInfoMapping[symbol] = {
        bufferedUpdates: new CircularBuffer<HuobiMBPDataMessage>(20)
      }
    }

    const mbpInfo = this.symbolToMBPInfoMapping[symbol]
    const snapshotAlreadyProcessed = mbpInfo.snapshotProcessed

    if (isSnapshot(message)) {
      const snapshotBids = message.data.bids.map(this._mapBookLevel)
      const snapshotAsks = message.data.asks.map(this._mapBookLevel)

      // if there were any depth updates buffered, let's proccess those by adding to or updating the initial snapshot
      // when prevSeqNum >= snapshot seqNum
      for (const update of mbpInfo.bufferedUpdates.items()) {
        if (update.tick.prevSeqNum < message.data.seqNum) {
          continue
        }

        const bookChange = this._mapMBPUpdate(update, symbol, localTimestamp)
        if (bookChange !== undefined) {
          for (const bid of bookChange.bids) {
            const matchingBid = snapshotBids.find((b) => b.price === bid.price)
            if (matchingBid !== undefined) {
              matchingBid.amount = bid.amount
            } else {
              snapshotBids.push(bid)
            }
          }

          for (const ask of bookChange.asks) {
            const matchingAsk = snapshotAsks.find((a) => a.price === ask.price)
            if (matchingAsk !== undefined) {
              matchingAsk.amount = ask.amount
            } else {
              snapshotAsks.push(ask)
            }
          }
        }
      }

      mbpInfo.snapshotProcessed = true

      yield {
        type: 'book_change',
        symbol,
        exchange: this._exchange,
        isSnapshot: true,
        bids: snapshotBids,
        asks: snapshotAsks,
        timestamp: new Date(message.ts),
        localTimestamp
      } as const
    } else {
      mbpInfo.bufferedUpdates.append(message)

      if (snapshotAlreadyProcessed) {
        // snapshot was already processed let's map the mbp message as normal book_change
        const update = this._mapMBPUpdate(message, symbol, localTimestamp)
        if (update !== undefined) {
          yield update
        }
      }
    }
  }

  private _mapMBPUpdate(message: HuobiMBPDataMessage, symbol: string, localTimestamp: Date) {
    const bids = Array.isArray(message.tick.bids) ? message.tick.bids : []
    const asks = Array.isArray(message.tick.asks) ? message.tick.asks : []

    if (bids.length === 0 && asks.length === 0) {
      return
    }

    return {
      type: 'book_change',
      symbol,
      exchange: this._exchange,
      isSnapshot: false,
      bids: bids.map(this._mapBookLevel),
      asks: asks.map(this._mapBookLevel),
      timestamp: new Date(message.ts),
      localTimestamp: localTimestamp
    } as const
  }

  private _mapBookLevel(level: HuobiBookLevel) {
    return { price: level[0], amount: level[1] }
  }
}

function normalizeSymbols(symbols?: string[]) {
  if (symbols !== undefined) {
    return symbols.map((s) => {
      // huobi-dm and huobi-dm-swap expect symbols to be upper cased
      if (s.includes('_') || s.includes('-')) {
        return s.toUpperCase()
      }
      // huobi global expects lower cased symbols
      return s.toLowerCase()
    })
  }
  return
}

export class HuobiDerivativeTickerMapper implements Mapper<'huobi-dm' | 'huobi-dm-swap' | 'huobi-dm-linear-swap', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: any) {
    if (message.ch !== undefined) {
      return message.ch.includes('.basis.') || message.ch.endsWith('.open_interest')
    }

    if (message.op === 'notify' && message.topic !== undefined) {
      return message.topic.endsWith('.funding_rate')
    }

    return false
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    const filters: FilterForExchange['huobi-dm-swap'][] = [
      {
        channel: 'basis',
        symbols
      },
      {
        channel: 'open_interest',
        symbols
      }
    ]

    if (this._exchange === 'huobi-dm-swap' || this._exchange === 'huobi-dm-linear-swap') {
      filters.push({
        channel: 'funding_rate',
        symbols
      })
    }

    return filters
  }

  *map(
    message: HuobiBasisDataMessage | HuobiFundingRateNotification | HuobiOpenInterestDataMessage,
    localTimestamp: Date
  ): IterableIterator<DerivativeTicker> {
    if ('op' in message) {
      // handle funding_rate notification message
      const fundingInfo = message.data[0]
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(fundingInfo.contract_code, this._exchange)

      pendingTickerInfo.updateFundingRate(Number(fundingInfo.funding_rate))
      pendingTickerInfo.updateFundingTimestamp(new Date(Number(fundingInfo.settlement_time)))
      pendingTickerInfo.updatePredictedFundingRate(Number(fundingInfo.estimated_rate))
      pendingTickerInfo.updateTimestamp(new Date(message.ts))

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    } else {
      const symbol = message.ch.split('.')[1]
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(symbol, this._exchange)

      // basis message
      if ('tick' in message) {
        pendingTickerInfo.updateIndexPrice(Number(message.tick.index_price))
        pendingTickerInfo.updateLastPrice(Number(message.tick.contract_price))
      } else {
        // open interest message
        const openInterest = message.data[0]
        pendingTickerInfo.updateOpenInterest(Number(openInterest.volume))
      }

      pendingTickerInfo.updateTimestamp(new Date(message.ts))

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

export class HuobiLiquidationsMapper implements Mapper<'huobi-dm' | 'huobi-dm-swap' | 'huobi-dm-linear-swap', Liquidation> {
  private readonly _contractCodeToSymbolMap: Map<string, string> = new Map()
  private readonly _contractTypesSuffixes = { this_week: 'CW', next_week: 'NW', quarter: 'CQ', next_quarter: 'NQ' }

  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: HuobiLiquidationOrder | HuobiContractInfo) {
    if (message.op !== 'notify') {
      return false
    }

    if (this._exchange === 'huobi-dm' && message.topic.endsWith('.contract_info')) {
      this._updateContractCodeToSymbolMap(message as HuobiContractInfo)
    }

    return message.topic.endsWith('.liquidation_orders')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    if (this._exchange === 'huobi-dm') {
      // huobi-dm for liquidations requires prividing different symbols which are indexes names for example 'BTC' or 'ETH'
      // not futures names like 'BTC_NW'
      // see https://huobiapi.github.io/docs/dm/v1/en/#subscribe-liquidation-order-data-no-authentication-sub

      if (symbols !== undefined) {
        symbols = symbols.map((s) => s.split('_')[0])
      }

      // we also need to subscribe to contract_info which will provide us information that will allow us to map
      // liquidation message symbol and contract code to symbols we expect (BTC_NW etc)

      return [
        {
          channel: 'liquidation_orders',
          symbols
        } as const,
        {
          channel: 'contract_info',
          symbols
        } as const
      ]
    } else {
      // huobi dm swap liquidations messages provide correct symbol & contract code
      return [
        {
          channel: 'liquidation_orders',
          symbols
        } as const
      ]
    }
  }

  private _updateContractCodeToSymbolMap(message: HuobiContractInfo) {
    for (const item of message.data) {
      this._contractCodeToSymbolMap.set(item.contract_code, `${item.symbol}_${this._contractTypesSuffixes[item.contract_type]}`)
    }
  }

  *map(message: HuobiLiquidationOrder, localTimestamp: Date): IterableIterator<Liquidation> {
    for (const huobiLiquidation of message.data) {
      let symbol = huobiLiquidation.contract_code
      // huobi-dm returns index name as a symbol, not future alias, so we need to map it here
      if (this._exchange === 'huobi-dm') {
        const futureAliasSymbol = this._contractCodeToSymbolMap.get(huobiLiquidation.contract_code)
        if (futureAliasSymbol === undefined) {
          continue
        }

        symbol = futureAliasSymbol
      }

      yield {
        type: 'liquidation',
        symbol,
        exchange: this._exchange,
        id: undefined,
        price: huobiLiquidation.price,
        amount: huobiLiquidation.volume,
        side: huobiLiquidation.direction,
        timestamp: new Date(huobiLiquidation.created_at),
        localTimestamp: localTimestamp
      }
    }
  }
}

export class HuobiOptionsSummaryMapper implements Mapper<'huobi-dm-options', OptionSummary> {
  private readonly _indexPrices = new Map<string, number>()
  private readonly _openInterest = new Map<string, number>()

  canHandle(message: HuobiOpenInterestDataMessage | HuobiOptionsIndexMessage | HuobiOptionsMarketIndexMessage) {
    if (message.ch === undefined) {
      return false
    }

    return message.ch.endsWith('.open_interest') || message.ch.endsWith('.option_index') || message.ch.endsWith('.option_market_index')
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
        channel: `open_interest`,
        symbols
      } as const,
      {
        channel: `option_index`,
        symbols: indexes
      } as const,
      {
        channel: 'option_market_index',
        symbols
      } as const
    ]
  }

  *map(
    message: HuobiOpenInterestDataMessage | HuobiOptionsIndexMessage | HuobiOptionsMarketIndexMessage,
    localTimestamp: Date
  ): IterableIterator<OptionSummary> | undefined {
    if (message.ch.endsWith('.option_index')) {
      const indexUpdateMessage = message as HuobiOptionsIndexMessage
      this._indexPrices.set(indexUpdateMessage.data.symbol, indexUpdateMessage.data.index_price)

      return
    }

    if (message.ch.endsWith('.open_interest')) {
      const openInterestMessage = message as HuobiOptionsOpenInterestMessage
      for (const ioMessage of openInterestMessage.data) {
        this._openInterest.set(ioMessage.contract_code, ioMessage.volume)
      }

      return
    }

    const marketIndexMessage = message as HuobiOptionsMarketIndexMessage

    const symbolParts = marketIndexMessage.data.contract_code.split('-')

    const expirationDate = new Date(`20${symbolParts[2].slice(0, 2)}-${symbolParts[2].slice(2, 4)}-${symbolParts[2].slice(4, 6)}Z`)
    expirationDate.setUTCHours(8)

    const underlying = `${symbolParts[0]}-${symbolParts[1]}`

    const lastUnderlyingPrice = this._indexPrices.get(underlying)
    const openInterest = this._openInterest.get(marketIndexMessage.data.contract_code)

    const optionSummary: OptionSummary = {
      type: 'option_summary',
      symbol: marketIndexMessage.data.contract_code,
      exchange: 'huobi-dm-options',
      optionType: marketIndexMessage.data.option_right_type === 'P' ? 'put' : 'call',
      strikePrice: Number(symbolParts[4]),
      expirationDate,

      bestBidPrice: asNumberIfValid(marketIndexMessage.data.bid_one),

      bestBidAmount: undefined,
      bestBidIV: asNumberIfValid(marketIndexMessage.data.iv_bid_one),

      bestAskPrice: asNumberIfValid(marketIndexMessage.data.ask_one),
      bestAskAmount: undefined,
      bestAskIV: asNumberIfValid(marketIndexMessage.data.iv_ask_one),

      lastPrice: asNumberIfValid(marketIndexMessage.data.last_price),

      openInterest,

      markPrice: marketIndexMessage.data.mark_price > 0 ? asNumberIfValid(marketIndexMessage.data.mark_price) : undefined,
      markIV: asNumberIfValid(marketIndexMessage.data.iv_mark_price),

      delta: asNumberIfValid(marketIndexMessage.data.delta),
      gamma: asNumberIfValid(marketIndexMessage.data.gamma),
      vega: asNumberIfValid(marketIndexMessage.data.vega),
      theta: asNumberIfValid(marketIndexMessage.data.theta),
      rho: undefined,

      underlyingPrice: lastUnderlyingPrice,
      underlyingIndex: underlying,

      timestamp: new Date(marketIndexMessage.ts),
      localTimestamp: localTimestamp
    }

    yield optionSummary
  }
}

export class HuobiBookTickerMapper implements Mapper<'huobi' | 'huobi-dm' | 'huobi-dm-swap' | 'huobi-dm-linear-swap', BookTicker> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: HuobiDataMessage) {
    if (message.ch === undefined) {
      return false
    }
    return message.ch.endsWith('.bbo')
  }

  getFilters(symbols?: string[]) {
    symbols = normalizeSymbols(symbols)

    return [
      {
        channel: 'bbo',
        symbols
      } as const
    ]
  }

  *map(message: HuobiBBOMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    const symbol = message.ch.split('.')[1].toUpperCase()

    if ('quoteTime' in message.tick) {
      yield {
        type: 'book_ticker',
        symbol,
        exchange: this._exchange,

        askAmount: asNumberIfValid(message.tick.askSize),
        askPrice: asNumberIfValid(message.tick.ask),

        bidPrice: asNumberIfValid(message.tick.bid),
        bidAmount: asNumberIfValid(message.tick.bidSize),
        timestamp: new Date(message.tick.quoteTime),
        localTimestamp: localTimestamp
      }
    } else {
      yield {
        type: 'book_ticker',
        symbol,
        exchange: this._exchange,

        askAmount: message.tick.ask !== undefined ? asNumberIfValid(message.tick.ask[1]) : undefined,
        askPrice: message.tick.ask !== undefined ? asNumberIfValid(message.tick.ask[0]) : undefined,

        bidPrice: message.tick.bid !== undefined ? asNumberIfValid(message.tick.bid[0]) : undefined,
        bidAmount: message.tick.bid !== undefined ? asNumberIfValid(message.tick.bid[1]) : undefined,
        timestamp: new Date(message.tick.ts),
        localTimestamp: localTimestamp
      }
    }
  }
}

type HuobiDataMessage = {
  ch: string
}

type HuobiTradeDataMessage = HuobiDataMessage & {
  tick: {
    data: {
      id: number
      tradeId?: number
      price: number
      amount: number
      direction: 'buy' | 'sell'
      ts: number
    }[]
  }
}

type HuobiBookLevel = [number, number]

type HuobiDepthDataMessage = HuobiDataMessage &
  (
    | {
        update?: boolean
        ts: number
        tick: {
          bids: HuobiBookLevel[] | null
          asks: HuobiBookLevel[] | null
        }
      }
    | {
        ts: number
        tick: {
          bids?: HuobiBookLevel[] | null
          asks?: HuobiBookLevel[] | null
          event: 'snapshot' | 'update'
        }
      }
  )

type HuobiBasisDataMessage = HuobiDataMessage & {
  ts: number
  tick: {
    index_price: string
    contract_price: string
  }
}

type HuobiFundingRateNotification = {
  op: 'notify'
  topic: string
  ts: number
  data: {
    settlement_time: string
    funding_rate: string
    estimated_rate: string
    contract_code: string
  }[]
}

type HuobiOpenInterestDataMessage = HuobiDataMessage & {
  ts: number
  data: {
    volume: number
  }[]
}

type HuobiMBPDataMessage = HuobiDataMessage & {
  ts: number
  tick: {
    bids?: HuobiBookLevel[] | null
    asks?: HuobiBookLevel[] | null
    seqNum: number
    prevSeqNum: number
  }
}

type HuobiMBPSnapshot = {
  ts: number
  rep: string
  data: {
    bids: HuobiBookLevel[]
    asks: HuobiBookLevel[]
    seqNum: number
  }
}

type MBPInfo = {
  bufferedUpdates: CircularBuffer<HuobiMBPDataMessage>
  snapshotProcessed?: boolean
}

type HuobiLiquidationOrder = {
  op: 'notify'
  topic: string
  ts: number
  data: {
    symbol: string
    contract_code: string
    direction: 'buy' | 'sell'
    offset: string
    volume: number
    price: number
    created_at: number
  }[]
}

type HuobiContractInfo = {
  op: 'notify'
  topic: string
  ts: number
  data: {
    symbol: string
    contract_code: string
    contract_type: 'this_week' | 'next_week' | 'quarter' | 'next_quarter'
  }[]
}

type HuobiOptionsOpenInterestMessage = {
  ch: 'market.BTC-USDT-210521-C-42000.open_interest'
  generated: true
  data: [
    {
      volume: 684.0
      amount: 0.684
      symbol: 'BTC'
      contract_type: 'this_week'
      contract_code: 'BTC-USDT-210521-C-42000'
      trade_partition: 'USDT'
      trade_amount: 0.792
      trade_volume: 792
      trade_turnover: 3237.37806
    }
  ]
  ts: 1621296002336
}

type HuobiOptionsIndexMessage = {
  ch: 'market.BTC-USDT.option_index'
  generated: true
  data: { symbol: 'BTC-USDT'; index_price: 43501.21; index_ts: 1621295997270 }
  ts: 1621296002825
}

type HuobiOptionsMarketIndexMessage = {
  ch: 'market.BTC-USDT-210521-P-42000.option_market_index'
  generated: true
  data: {
    contract_code: 'BTC-USDT-210521-P-42000'
    symbol: 'BTC'
    iv_last_price: 1.62902357
    iv_ask_one: 1.64869787
    iv_bid_one: 1.13185884
    iv_mark_price: 1.39190675
    delta: -0.3704996546766173
    gamma: 0.00006528
    theta: -327.85540508
    vega: 15.70293917
    ask_one: 2000
    bid_one: 1189.49
    last_price: 1968.83
    mark_price: 1594.739777491571343067
    trade_partition: 'USDT'
    contract_type: 'this_week'
    option_right_type: 'P'
  }
  ts: 1621296002820
}

type HuobiBBOMessage =
  | {
      ch: 'market.BTC-USDT.bbo'
      ts: 1630454400495
      tick: {
        mrid: 64797873746
        id: 1630454400
        bid: [47176.5, 1] | undefined
        ask: [47176.6, 9249] | undefined
        ts: 1630454400495
        version: 64797873746
        ch: 'market.BTC-USDT.bbo'
      }
    }
  | {
      ch: 'market.btcusdt.bbo'
      ts: 1575158404058
      tick: {
        seqId: 103273695595
        ask: 7543.59
        askSize: 2.323241
        bid: 7541.16
        bidSize: 0.002329
        quoteTime: 1575158404057
        symbol: 'btcusdt'
      }
    }
