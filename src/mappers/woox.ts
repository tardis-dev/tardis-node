import { asNumberOrUndefined, upperCaseSymbols } from '../handy.ts'
import { BookChange, BookTicker, DerivativeTicker, Trade } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'
import { exchangeMappers, mapper } from './registry.ts'

const WOOX_V3_SWITCH_DATE = new Date('2026-06-29T22:02:00.000Z')

// WOO X kept Tardis channel names during the V3 rollout, but changed raw topic layout and payload fields.
// Keep old and V3 mappers separate so replay uses the schema that was actually recorded at the message time.
export const wooxMappers = exchangeMappers({
  'woo-x': {
    trades: mapper([{ until: WOOX_V3_SWITCH_DATE, use: () => wooxTradesMapper }, { use: () => wooxV3TradesMapper }]),
    bookChanges: mapper([
      { until: WOOX_V3_SWITCH_DATE, use: () => new WooxBookChangeMapper() },
      { use: () => new WooxV3BookChangeMapper() }
    ]),
    derivativeTickers: mapper([
      { until: WOOX_V3_SWITCH_DATE, use: () => new WooxDerivativeTickerMapper() },
      { use: () => new WooxV3DerivativeTickerMapper() }
    ]),
    bookTickers: mapper([
      { until: WOOX_V3_SWITCH_DATE, use: () => new WooxBookTickerMapper() },
      { use: () => new WooxV3BookTickerMapper() }
    ])
  }
})

const wooxTradesMapper: Mapper<'woo-x', Trade> = {
  canHandle(message: WooxTradeMessage) {
    return message.topic !== undefined && message.topic.endsWith('@trade')
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trade',
        symbols
      }
    ]
  },

  *map(message: WooxTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    const timestamp = new Date(message.ts)
    // any trade with source = 0 is mainly for informational purposes for our users, not actual trades printed on WOO X
    if (message.data.source === 0) {
      return
    }

    yield {
      type: 'trade',
      symbol: message.data.symbol,
      exchange: 'woo-x',
      id: undefined,
      price: message.data.price,
      amount: message.data.size,
      side: message.data.side === 'SELL' ? 'sell' : 'buy',
      timestamp,
      localTimestamp: localTimestamp
    }
  }
}

const wooxV3TradesMapper: Mapper<'woo-x', Trade> = {
  canHandle(message: WooxV3TradeMessage) {
    return message.topic !== undefined && message.topic.startsWith('trade@')
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trade',
        symbols
      }
    ]
  },

  *map(message: WooxV3TradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    if (message.data.src === 0) {
      return
    }

    yield {
      type: 'trade',
      symbol: message.data.s,
      exchange: 'woo-x',
      id: undefined,
      price: Number(message.data.px),
      amount: Number(message.data.sx),
      side: message.data.sd === 'SELL' ? 'sell' : 'buy',
      timestamp: new Date(message.data.ts),
      localTimestamp
    }
  }
}

class WooxBookChangeMapper implements Mapper<'woo-x', BookChange> {
  private readonly _symbolToDepthInfoMapping: { [key: string]: LocalDepthInfo } = {}

  canHandle(message: WooxOrderbookMessage | WooxOrderbookupdateMessage) {
    if ('id' in message) {
      return message.id.endsWith('@orderbook')
    }

    if ('topic' in message) {
      return message.topic.endsWith('@orderbookupdate')
    }

    return false
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'orderbook',
        symbols
      },
      {
        channel: 'orderbookupdate',
        symbols
      }
    ]
  }

  *map(message: WooxOrderbookMessage | WooxOrderbookupdateMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const symbol = message.data.symbol

    if (this._symbolToDepthInfoMapping[symbol] === undefined) {
      this._symbolToDepthInfoMapping[symbol] = {
        bufferedUpdates: []
      }
    }

    const symbolDepthInfo = this._symbolToDepthInfoMapping[symbol]
    const snapshotAlreadyProcessed = symbolDepthInfo.snapshotProcessed

    // first check if received message is snapshot and process it as such if it is
    if ('id' in message && message.success) {
      yield {
        type: 'book_change',
        symbol,
        exchange: 'woo-x',
        isSnapshot: true,
        bids: message.data.bids.map(this._mapBookLevel),
        asks: message.data.asks.map(this._mapBookLevel),
        timestamp: new Date(message.data.ts),
        localTimestamp
      }

      //  mark given symbol depth info that has snapshot processed
      symbolDepthInfo.lastUpdateTimestamp = message.data.ts
      symbolDepthInfo.snapshotProcessed = true

      // if there were any depth updates buffered, let's proccess those
      for (const update of symbolDepthInfo.bufferedUpdates) {
        const bookChange = this._mapBookDepthUpdate(update, localTimestamp, symbolDepthInfo, symbol)
        if (bookChange !== undefined) {
          yield bookChange
        }
      }
      // remove all buffered updates
      symbolDepthInfo.bufferedUpdates = []
    } else if (snapshotAlreadyProcessed) {
      // snapshot was already processed let's map the message as normal book_change
      const bookChange = this._mapBookDepthUpdate(message as WooxOrderbookupdateMessage, localTimestamp, symbolDepthInfo, symbol)
      if (bookChange !== undefined) {
        yield bookChange
      }
    } else {
      // if snapshot hasn't been yet processed and we've got depthUpdate message, let's buffer it for later processing
      symbolDepthInfo.bufferedUpdates.push(message as WooxOrderbookupdateMessage)
    }
  }

  private _mapBookDepthUpdate(
    wooxBookUpdate: WooxOrderbookupdateMessage,
    localTimestamp: Date,
    depthInfo: LocalDepthInfo,
    symbol: string
  ): BookChange | undefined {
    if (wooxBookUpdate.data.prevTs < depthInfo.lastUpdateTimestamp!) {
      return
    }

    return {
      type: 'book_change',
      symbol,
      exchange: 'woo-x',
      isSnapshot: false,
      bids: wooxBookUpdate.data.bids.map(this._mapBookLevel),
      asks: wooxBookUpdate.data.asks.map(this._mapBookLevel),
      timestamp: new Date(wooxBookUpdate.ts),
      localTimestamp
    }
  }

  private _mapBookLevel(level: [number, number]) {
    const price = level[0]
    const amount = level[1]

    return { price, amount }
  }
}

class WooxV3BookChangeMapper implements Mapper<'woo-x', BookChange> {
  private readonly _symbolToDepthInfoMapping: { [key: string]: WooxV3LocalDepthInfo } = {}

  canHandle(message: WooxV3OrderbookMessage | WooxV3OrderbookupdateMessage) {
    if (message.topic === undefined) {
      return false
    }

    if (message.topic.startsWith('orderbook@')) {
      return 'generated' in message && message.generated === true
    }

    return message.topic.startsWith('orderbookupdate@')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'orderbook',
        symbols
      },
      {
        channel: 'orderbookupdate',
        symbols
      }
    ]
  }

  *map(message: WooxV3OrderbookMessage | WooxV3OrderbookupdateMessage, localTimestamp: Date): IterableIterator<BookChange> {
    if ('generated' in message) {
      const symbol = message.data.s ?? message.topic.split('@')[1]
      const timestamp = message.data.ts ?? message.ts

      if (this._symbolToDepthInfoMapping[symbol] === undefined) {
        this._symbolToDepthInfoMapping[symbol] = {
          bufferedUpdates: []
        }
      }

      const symbolDepthInfo = this._symbolToDepthInfoMapping[symbol]

      yield {
        type: 'book_change',
        symbol,
        exchange: 'woo-x',
        isSnapshot: true,
        bids: message.data.bids.map(this._mapSnapshotLevel),
        asks: message.data.asks.map(this._mapSnapshotLevel),
        timestamp: new Date(timestamp),
        localTimestamp
      }

      symbolDepthInfo.lastUpdateTimestamp = timestamp
      symbolDepthInfo.snapshotProcessed = true

      for (const update of symbolDepthInfo.bufferedUpdates) {
        const bookChange = this._mapBookDepthUpdate(update, localTimestamp, symbolDepthInfo, symbol)
        if (bookChange !== undefined) {
          yield bookChange
        }
      }
      symbolDepthInfo.bufferedUpdates = []
      return
    }

    const symbol = message.data.s

    if (this._symbolToDepthInfoMapping[symbol] === undefined) {
      this._symbolToDepthInfoMapping[symbol] = {
        bufferedUpdates: []
      }
    }

    const symbolDepthInfo = this._symbolToDepthInfoMapping[symbol]
    const snapshotAlreadyProcessed = symbolDepthInfo.snapshotProcessed

    if (snapshotAlreadyProcessed) {
      const bookChange = this._mapBookDepthUpdate(message, localTimestamp, symbolDepthInfo, symbol)
      if (bookChange !== undefined) {
        yield bookChange
      }
    } else {
      symbolDepthInfo.bufferedUpdates.push(message)
    }
  }

  private _mapBookDepthUpdate(
    wooxBookUpdate: WooxV3OrderbookupdateMessage,
    localTimestamp: Date,
    depthInfo: WooxV3LocalDepthInfo,
    symbol: string
  ): BookChange | undefined {
    if (wooxBookUpdate.data.prevTs < depthInfo.lastUpdateTimestamp!) {
      return
    }

    return {
      type: 'book_change',
      symbol,
      exchange: 'woo-x',
      isSnapshot: false,
      bids: wooxBookUpdate.data.bids.map(this._mapUpdateLevel),
      asks: wooxBookUpdate.data.asks.map(this._mapUpdateLevel),
      timestamp: new Date(wooxBookUpdate.data.ts),
      localTimestamp
    }
  }

  private _mapSnapshotLevel(level: WooxV3OrderbookSnapshotLevel): { price: number; amount: number } {
    if (Array.isArray(level)) {
      return { price: Number(level[0]), amount: Number(level[1]) }
    }

    return { price: Number(level.price), amount: Number(level.quantity) }
  }

  private _mapUpdateLevel(level: WooxV3BookLevel) {
    return { price: Number(level[0]), amount: Number(level[1]) }
  }
}

class WooxDerivativeTickerMapper implements Mapper<'woo-x', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()
  private readonly _indexPrices = new Map<string, number>()

  canHandle(message: WooxTradeMessage | WooxEstFundingRate | WooxMarkPrice | WooxIndexPrice | WooxOpenInterest) {
    if (message.topic === undefined) {
      return false
    }
    const symbol = (message.data && message.data.symbol) || ''
    const isPerp = symbol.startsWith('PERP_')

    return (
      (message.topic.endsWith('@trade') && isPerp) ||
      (message.topic.endsWith('@markprice') && isPerp) ||
      (message.topic.endsWith('@estfundingrate') && isPerp) ||
      message.topic.endsWith('@indexprice') ||
      (message.topic.endsWith('@openinterest') && isPerp)
    )
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    const spotSymbols = symbols !== undefined ? symbols.map((s) => s.replace('PERP_', 'SPOT_')) : []
    return [
      {
        channel: 'trade',
        symbols
      },
      {
        channel: 'markprice',
        symbols
      },
      {
        channel: 'estfundingrate',
        symbols
      },
      {
        channel: 'openinterest',
        symbols
      },
      {
        channel: 'indexprice',
        symbols: spotSymbols
      }
    ]
  }

  *map(message: any, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    if (message.topic.endsWith('@indexprice')) {
      this._indexPrices.set(message.data.symbol.replace('SPOT_', 'PERP_'), message.data.price)
    } else {
      const symbol = message.data.symbol
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(symbol, 'woo-x')

      const lastIndexPrice = this._indexPrices.get(symbol)
      if (lastIndexPrice !== undefined) {
        pendingTickerInfo.updateIndexPrice(lastIndexPrice)
      }

      if (message.topic.endsWith('@markprice')) {
        pendingTickerInfo.updateMarkPrice(message.data.price)
        pendingTickerInfo.updateTimestamp(new Date(message.ts))
      }

      if (message.topic.endsWith('@trade')) {
        pendingTickerInfo.updateLastPrice(message.data.price)
        pendingTickerInfo.updateTimestamp(new Date(message.ts))
      }

      if (message.topic.endsWith('@estfundingrate')) {
        pendingTickerInfo.updateFundingRate(message.data.fundingRate)
        pendingTickerInfo.updateFundingTimestamp(new Date(message.data.fundingTs))
        pendingTickerInfo.updateTimestamp(new Date(message.ts))
      }

      if (message.topic.endsWith('@openinterest')) {
        pendingTickerInfo.updateOpenInterest(message.data.openInterest)
        pendingTickerInfo.updateTimestamp(new Date(message.ts))
      }

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

class WooxV3DerivativeTickerMapper implements Mapper<'woo-x', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()
  private readonly _indexPrices = new Map<string, number>()

  canHandle(message: WooxV3TradeMessage | WooxV3EstFundingRate | WooxV3MarkPrice | WooxV3IndexPrice | WooxV3OpenInterest) {
    if (message.topic === undefined) {
      return false
    }
    const symbol = (message.data && message.data.s) || ''
    const isPerp = symbol.startsWith('PERP_')

    return (
      (message.topic.startsWith('trade@') && isPerp) ||
      (message.topic.startsWith('markprice@') && isPerp) ||
      (message.topic.startsWith('estfundingrate@') && isPerp) ||
      message.topic.startsWith('indexprice@') ||
      (message.topic.startsWith('openinterest@') && isPerp)
    )
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    const spotSymbols = symbols !== undefined ? symbols.map((s) => s.replace('PERP_', 'SPOT_')) : []

    return [
      {
        channel: 'trade',
        symbols
      },
      {
        channel: 'markprice',
        symbols
      },
      {
        channel: 'estfundingrate',
        symbols
      },
      {
        channel: 'openinterest',
        symbols
      },
      {
        channel: 'indexprice',
        symbols: spotSymbols
      }
    ]
  }

  *map(message: WooxV3TradeMessage | WooxV3EstFundingRate | WooxV3MarkPrice | WooxV3IndexPrice | WooxV3OpenInterest, localTimestamp: Date) {
    if (message.topic.startsWith('indexprice@')) {
      const data = message.data as WooxV3IndexPrice['data']
      this._indexPrices.set(data.s.replace('SPOT_', 'PERP_'), Number(data.px))
    } else {
      const symbol = message.data.s
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(symbol, 'woo-x')

      const lastIndexPrice = this._indexPrices.get(symbol)
      if (lastIndexPrice !== undefined) {
        pendingTickerInfo.updateIndexPrice(lastIndexPrice)
      }

      if (message.topic.startsWith('markprice@')) {
        const data = message.data as WooxV3MarkPrice['data']
        pendingTickerInfo.updateMarkPrice(Number(data.px))
        pendingTickerInfo.updateTimestamp(new Date(message.data.ts))
      }

      if (message.topic.startsWith('trade@')) {
        const data = message.data as WooxV3TradeMessage['data']
        pendingTickerInfo.updateLastPrice(Number(data.px))
        pendingTickerInfo.updateTimestamp(new Date(message.data.ts))
      }

      if (message.topic.startsWith('estfundingrate@')) {
        const data = message.data as WooxV3EstFundingRate['data']
        pendingTickerInfo.updateFundingRate(Number(data.r))
        pendingTickerInfo.updateFundingTimestamp(new Date(Number(data.ft)))
        pendingTickerInfo.updateTimestamp(new Date(message.data.ts))
      }

      if (message.topic.startsWith('openinterest@')) {
        const data = message.data as WooxV3OpenInterest['data']
        pendingTickerInfo.updateOpenInterest(Number(data.oi))
        pendingTickerInfo.updateTimestamp(new Date(message.data.ts))
      }

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

class WooxBookTickerMapper implements Mapper<'woo-x', BookTicker> {
  canHandle(message: WooxTradeMessage) {
    return message.topic !== undefined && message.topic.endsWith('@bbo')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'bbo',
        symbols
      }
    ]
  }

  *map(wooxBBOMessage: WooxBBOMessage, localTimestamp: Date) {
    const wooxBookTicker = wooxBBOMessage.data

    const ticker: BookTicker = {
      type: 'book_ticker',
      symbol: wooxBookTicker.symbol,
      exchange: 'woo-x',
      askAmount: wooxBookTicker.askSize !== undefined ? wooxBookTicker.askSize : undefined,
      askPrice: wooxBookTicker.ask !== undefined ? wooxBookTicker.ask : undefined,

      bidPrice: wooxBookTicker.bid !== undefined ? wooxBookTicker.bid : undefined,
      bidAmount: wooxBookTicker.bidSize !== undefined ? wooxBookTicker.bidSize : undefined,
      timestamp: new Date(wooxBBOMessage.ts),
      localTimestamp: localTimestamp
    }

    yield ticker
  }
}

class WooxV3BookTickerMapper implements Mapper<'woo-x', BookTicker> {
  canHandle(message: WooxV3BBOMessage) {
    return message.topic !== undefined && message.topic.startsWith('bbo@')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'bbo',
        symbols
      }
    ]
  }

  *map(wooxBBOMessage: WooxV3BBOMessage, localTimestamp: Date) {
    const wooxBookTicker = wooxBBOMessage.data

    const ticker: BookTicker = {
      type: 'book_ticker',
      symbol: wooxBookTicker.s,
      exchange: 'woo-x',
      askAmount: asNumberOrUndefined(wooxBookTicker.aq),
      askPrice: asNumberOrUndefined(wooxBookTicker.ap),

      bidPrice: asNumberOrUndefined(wooxBookTicker.bp),
      bidAmount: asNumberOrUndefined(wooxBookTicker.bq),
      timestamp: new Date(wooxBookTicker.ts),
      localTimestamp: localTimestamp
    }

    yield ticker
  }
}

type LocalDepthInfo = {
  bufferedUpdates: WooxOrderbookupdateMessage[]
  snapshotProcessed?: boolean
  lastUpdateTimestamp?: number
}

type WooxTradeMessage = {
  topic: 'PERP_GALA_USDT@trade'
  ts: 1674431999995
  data: { symbol: 'PERP_GALA_USDT'; price: 0.048756; size: 4109; side: 'SELL'; source: 0 }
}

type WooxV3TradeMessage = {
  topic: string
  ts: number
  data: { s: string; px: string; sx: string; sd: 'BUY' | 'SELL'; src: number; ts: number }
}

type WooxOrderbookupdateMessage = {
  topic: 'PERP_BTC_USDT@orderbookupdate'
  ts: 1674432000020
  data: {
    symbol: 'PERP_BTC_USDT'
    prevTs: 1674432000030
    asks: [[22712.7, 15.4675]]
    bids: [[22708.0, 4.503]]
  }
}

type WooxOrderbookMessage = {
  id: 'PERP_BTC_USDT@orderbook'
  event: 'request'
  success: true
  ts: 1674432000034
  data: {
    symbol: 'PERP_BTC_USDT'
    ts: 1674432000020
    asks: [[22712.7, 15.4675], [26772.1, 0.248]]
    bids: [[22708.0, 4.503], [18555.0, 0.002]]
  }
}

type WooxV3LocalDepthInfo = {
  bufferedUpdates: WooxV3OrderbookupdateMessage[]
  snapshotProcessed?: boolean
  lastUpdateTimestamp?: number
}

type WooxV3BookLevel = [string, string]

type WooxV3OrderbookupdateMessage = {
  topic: string
  ts: number
  data: {
    s: string
    prevTs: number
    ts: number
    asks: WooxV3BookLevel[]
    bids: WooxV3BookLevel[]
  }
}

type WooxV3OrderbookRestSnapshotLevel = {
  price: string
  quantity: string
}

type WooxV3OrderbookSnapshotLevel = WooxV3BookLevel | WooxV3OrderbookRestSnapshotLevel

type WooxV3OrderbookMessage = {
  topic: string
  ts: number
  generated: true
  data: {
    s?: string
    ts?: number
    asks: WooxV3OrderbookSnapshotLevel[]
    bids: WooxV3OrderbookSnapshotLevel[]
  }
}

type WooxBBOMessage = {
  topic: 'SPOT_ETH_USDT@bbo'
  ts: 1674431999996
  data: { symbol: 'SPOT_ETH_USDT'; ask: 1627.61; askSize: 38.3755; bid: 1627.26; bidSize: 20.424926 }
}

type WooxV3BBOMessage = {
  topic: string
  ts: number
  data: { s: string; ts: number; ap?: string; aq?: string; bp?: string; bq?: string }
}

type WooxMarkPrice = { topic: 'PERP_BTC_USDT@markprice'; ts: 1674432000007; data: { symbol: 'PERP_BTC_USDT'; price: 22711.11 } }

type WooxV3MarkPrice = { topic: string; ts: number; data: { s: string; ts: number; px: string } }

type WooxEstFundingRate = {
  topic: 'PERP_BTC_USDT@estfundingrate'
  ts: 1674432059002
  data: { symbol: 'PERP_BTC_USDT'; fundingRate: 0.00000782; fundingTs: 1674435600005 }
}

type WooxV3EstFundingRate = {
  topic: string
  ts: number
  data: { s: string; ts: number; r: string; ft: number | string }
}

type WooxIndexPrice = { topic: 'SPOT_BTC_USDT@indexprice'; ts: 1674432000024; data: { symbol: 'SPOT_BTC_USDT'; price: 22708.44 } }

type WooxV3IndexPrice = { topic: string; ts: number; data: { s: string; ts: number; px: string } }

type WooxOpenInterest = { topic: 'PERP_BTC_USDT@openinterest'; ts: 1674432013624; data: { symbol: 'PERP_BTC_USDT'; openInterest: 83.2241 } }

type WooxV3OpenInterest = { topic: string; ts: number; data: { s: string; ts: number; oi: string } }
