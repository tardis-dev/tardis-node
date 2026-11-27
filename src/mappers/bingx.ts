import { asNonZeroNumberOrUndefined, asNumberOrUndefined, upperCaseSymbols } from '../handy.ts'
import { BookChange, BookTicker, Trade } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'
import { exchangeMappers } from './registry.ts'

type BingxExchange = 'bingx' | 'bingx-futures'

export const bingxMappers = exchangeMappers({
  bingx: {
    trades: () => new BingxTradesMapper('bingx'),
    bookChanges: () => new BingxBookChangeMapper('bingx'),
    bookTickers: () => new BingxBookTickerMapper('bingx')
  },
  'bingx-futures': {
    trades: () => new BingxTradesMapper('bingx-futures'),
    bookChanges: () => new BingxBookChangeMapper('bingx-futures'),
    bookTickers: () => new BingxBookTickerMapper('bingx-futures'),
    derivativeTickers: () => new BingxDerivativeTickerMapper()
  }
})

class BingxTradesMapper implements Mapper<BingxExchange, Trade> {
  private readonly _isSpot: boolean

  constructor(private readonly _exchange: BingxExchange) {
    this._isSpot = _exchange === 'bingx'
  }

  canHandle(message: BingxMessage<unknown>) {
    return message.dataType?.endsWith('@trade') === true
  }

  getFilters(symbols: string[] = []) {
    return [{ channel: 'trade', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: BingxTradeMessage | BingxFuturesTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    const trades = this._isSpot ? [(message as BingxTradeMessage).data] : (message as BingxFuturesTradeMessage).data
    for (const trade of trades) {
      yield {
        type: 'trade',
        exchange: this._exchange,
        symbol: trade.s.toUpperCase(),
        id: trade.t,
        price: Number(trade.p),
        amount: Number(trade.q),
        side: trade.m ? 'sell' : 'buy',
        timestamp: new Date(trade.T),
        localTimestamp
      }
    }
  }
}

class BingxBookChangeMapper implements Mapper<BingxExchange, BookChange> {
  private readonly _isSpot: boolean

  constructor(private readonly _exchange: BingxExchange) {
    this._isSpot = _exchange === 'bingx'
  }

  canHandle(message: BingxMessage<unknown>) {
    return message.dataType?.endsWith('@incrDepth') === true
  }

  getFilters(symbols: string[] = []) {
    return [{ channel: 'incrDepth', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: BingxDepthMessage | BingxFuturesDepthMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const { data } = message

    yield {
      type: 'book_change',
      exchange: this._exchange,
      symbol: message.dataType.split('@')[0].toUpperCase(),
      isSnapshot: data.action === 'all',
      bids: (this._isSpot ? Object.entries(data.bids) : (data.bids as BingxFuturesDepthLevels)).map(this._mapLevels),
      asks: (this._isSpot ? Object.entries(data.asks) : (data.asks as BingxFuturesDepthLevels)).map(this._mapLevels),
      timestamp: new Date(this._isSpot ? message.timestamp! : (message as BingxFuturesDepthMessage).data.time),
      localTimestamp
    }
  }

  private _mapLevels([price, amount]: [string, string]) {
    return {
      price: Number(price),
      amount: Number(amount)
    }
  }
}

class BingxBookTickerMapper implements Mapper<BingxExchange, BookTicker> {
  private readonly _isSpot: boolean

  constructor(private readonly _exchange: BingxExchange) {
    this._isSpot = _exchange === 'bingx'
  }

  canHandle(message: BingxMessage<unknown>) {
    return message.dataType?.endsWith('@bookTicker') === true
  }

  getFilters(symbols: string[] = []) {
    return [{ channel: 'bookTicker', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map({ data }: BingxBookTickerMessage | BingxFuturesBookTickerMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    yield {
      type: 'book_ticker',
      exchange: this._exchange,
      symbol: data.s.toUpperCase(),
      bidPrice: this._isSpot ? asNumberOrUndefined(data.b) : asNonZeroNumberOrUndefined(data.b),
      bidAmount: this._isSpot ? asNumberOrUndefined(data.B) : asNonZeroNumberOrUndefined(data.B),
      askPrice: this._isSpot ? asNumberOrUndefined(data.a) : asNonZeroNumberOrUndefined(data.a),
      askAmount: this._isSpot ? asNumberOrUndefined(data.A) : asNonZeroNumberOrUndefined(data.A),
      timestamp: new Date(this._isSpot ? data.E : (data as BingxFuturesBookTickerMessage['data']).T),
      localTimestamp
    }
  }
}

class BingxDerivativeTickerMapper {
  private readonly _pendingTickers = new PendingTickerInfoHelper()

  canHandle(message: BingxMessage<unknown>) {
    return /@(markPrice|ticker|premiumIndex|openInterest)$/.test(message.dataType)
  }

  getFilters(symbols: string[] = []) {
    symbols = upperCaseSymbols(symbols)
    return [
      { channel: 'markPrice', symbols } as const,
      { channel: 'ticker', symbols } as const,
      { channel: 'premiumIndex', symbols } as const,
      { channel: 'openInterest', symbols } as const
    ]
  }

  *map(
    message: BingxFuturesTickerMessage | BingxFuturesMarkPriceMessage | BingxFuturesPremiumIndexMessage | BingxFuturesOpenInterestMessage,
    localTimestamp: Date
  ) {
    const symbol = message.dataType.split('@')[0].toUpperCase()
    const ticker = this._pendingTickers.getPendingTickerInfo(symbol, 'bingx-futures')

    if (message.dataType.endsWith('@ticker')) {
      const { data } = message as BingxFuturesTickerMessage
      ticker.updateLastPrice(Number(data.c))
      return
    }

    if (message.dataType.endsWith('@premiumIndex')) {
      const { data } = message as BingxFuturesPremiumIndexMessage
      ticker.updateIndexPrice(Number(data.indexPrice))
      ticker.updateFundingRate(Number(data.lastFundingRate))
      if (data.nextFundingTime > 0) {
        ticker.updateFundingTimestamp(new Date(data.nextFundingTime))
      }
      return
    }

    if (message.dataType.endsWith('@openInterest')) {
      const { data } = message as BingxFuturesOpenInterestMessage
      // BingX reports open interest in USDT; preserve the exchange's units.
      ticker.updateOpenInterest(Number(data.openInterest))
      return
    }

    const { data } = message as BingxFuturesMarkPriceMessage
    // WebSocket mark price owns the output timestamp. premiumIndex.updateTime is a funding settlement time.
    ticker.updateMarkPrice(Number(data.p))
    ticker.updateTimestamp(new Date(data.E))

    if (ticker.hasChanged()) {
      yield ticker.getSnapshot(localTimestamp)
    }
  }
}

/** @see https://bingx-api.github.io/docs-v3/#/en/Quick%20Start/WebSocket%20Rules/WebSocket%20Rules */
type BingxMessage<T> = {
  /** Symbol and channel in `symbol@channel` format, e.g. `BTC-USDT@trade`. */
  dataType: string
  data: T
  timestamp?: number
}

/** @see https://bingx-api.github.io/docs-v3/#/en/Spot/Websocket%20Market%20Data/Subscription%20transaction%20by%20transaction */
type BingxTradeMessage = BingxMessage<{
  e: 'trade'
  E: number
  s: string
  t: string
  p: string
  q: string
  m: boolean
  T: number
}>

/** @see https://bingx-api.github.io/docs-v3/#/en/Swap/Websocket%20Market%20Data/Subscribe%20the%20Latest%20Trade%20Detail */
type BingxFuturesTradeMessage = BingxMessage<
  {
    s: string
    t: string
    p: string
    q: string
    m: boolean
    T: number
  }[]
>

/** @see https://bingx-api.github.io/docs-v3/#/en/Spot/Websocket%20Market%20Data/Incremental%20and%20Full%20Depth%20Information */
type BingxDepthMessage = BingxMessage<{
  action: 'all' | 'update'
  lastUpdateId: number
  sourceUpdateId: number
  bids: BingxDepthLevels
  asks: BingxDepthLevels
}>

/** `[price]: amount` */
type BingxDepthLevels = { [price: string]: string }

/** @see https://bingx-api.github.io/docs-v3/#/en/Swap/Websocket%20Market%20Data/Incremental%20Depth%20Information */
type BingxFuturesDepthMessage = BingxMessage<{
  action: 'all' | 'update'
  lastUpdateId: number
  time: number
  bids: BingxFuturesDepthLevels
  asks: BingxFuturesDepthLevels
}>

/** Price and quantity pairs. */
type BingxFuturesDepthLevels = [price: string, quantity: string][]

/** @see https://bingx-api.github.io/docs-v3/#/en/Spot/Websocket%20Market%20Data/Spot%20Best%20Order%20Book */
type BingxBookTickerMessage = BingxMessage<{
  e: 'bookTicker'
  s: string
  b?: string
  B?: string
  a?: string
  A?: string
  E: number
}>

/** @see https://bingx-api.github.io/docs-v3/#/en/Swap/Websocket%20Market%20Data/Subscribe%20to%20the%20Book%20Ticker%20Streams */
type BingxFuturesBookTickerMessage = BingxMessage<{
  e: 'bookTicker'
  s: string
  b: string
  B: string
  a: string
  A: string
  E: number
  T: number
  u: number
}>

/** @see https://bingx-api.github.io/docs-v3/#/en/Swap/Websocket%20Market%20Data/Subscribe%20to%2024-hour%20price%20changes */
type BingxFuturesTickerMessage = BingxMessage<{
  e: '24hTicker'
  E: number
  s: string
  p: string
  P: string
  c: string
  L: string
  h: string
  l: string
  v: string
  q: string
  o: string
  O: number
  C: number
  A: string
  a: string
  B: string
  b: string
}>

/** @see https://bingx-api.github.io/docs-v3/#/en/Swap/Websocket%20Market%20Data/Subscribe%20to%20latest%20mark%20price%20changes */
type BingxFuturesMarkPriceMessage = BingxMessage<{
  e: 'markPriceUpdate'
  E: number
  s: string
  p: string
}>

/** @see https://bingx-api.github.io/docs-v3/#/en/Swap/Market%20Data/Mark%20Price%20and%20Funding%20Rate */
type BingxFuturesPremiumIndexMessage = BingxMessage<{
  symbol: string
  markPrice: string
  indexPrice: string
  lastFundingRate: string
  nextFundingTime: number
  fundingIntervalHours: number
  minFundingRate: string
  maxFundingRate: string
  updateTime: number
}>

/** @see https://bingx-api.github.io/docs-v3/#/en/Swap/Market%20Data/Open%20Interest%20Statistics */
type BingxFuturesOpenInterestMessage = BingxMessage<{
  symbol: string
  openInterest: string
  time: number
}>
