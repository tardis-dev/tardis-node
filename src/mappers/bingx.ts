import { asNumberOrUndefined, upperCaseSymbols } from '../handy.ts'
import { BookChange, BookTicker, Trade } from '../types.ts'
import { Mapper } from './mapper.ts'
import { exchangeMappers } from './registry.ts'

type BingxExchange = 'bingx'

export const bingxMappers = exchangeMappers({
  bingx: {
    trades: () => new BingxTradesMapper('bingx'),
    bookChanges: () => new BingxBookChangeMapper('bingx'),
    bookTickers: () => new BingxBookTickerMapper('bingx')
  }
})

class BingxTradesMapper implements Mapper<BingxExchange, Trade> {
  constructor(private readonly _exchange: BingxExchange) {}

  canHandle(message: BingxMessage<unknown>) {
    return message.dataType?.endsWith('@trade') === true
  }

  getFilters(symbols: string[] = []) {
    return [{ channel: 'trade', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: BingxTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    const trades = [message.data]
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
  constructor(private readonly _exchange: BingxExchange) {}

  canHandle(message: BingxMessage<unknown>) {
    return message.dataType?.endsWith('@incrDepth') === true
  }

  getFilters(symbols: string[] = []) {
    return [{ channel: 'incrDepth', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: BingxDepthMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const { data } = message
    yield {
      type: 'book_change',
      exchange: this._exchange,
      symbol: message.dataType.split('@')[0].toUpperCase(),
      isSnapshot: data.action === 'all',
      bids: this._mapLevels(data.bids),
      asks: this._mapLevels(data.asks),
      timestamp: new Date(message.timestamp!),
      localTimestamp
    }
  }

  private _mapLevels(levels: BingxDepthLevels) {
    return Object.entries(levels).map(([price, amount]) => ({
      price: Number(price),
      amount: Number(amount)
    }))
  }
}

class BingxBookTickerMapper implements Mapper<BingxExchange, BookTicker> {
  constructor(private readonly _exchange: BingxExchange) {}

  canHandle(message: BingxMessage<unknown>) {
    return message.dataType?.endsWith('@bookTicker') === true
  }

  getFilters(symbols: string[] = []) {
    return [{ channel: 'bookTicker', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map({ data }: BingxBookTickerMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    yield {
      type: 'book_ticker',
      exchange: this._exchange,
      symbol: data.s.toUpperCase(),
      bidPrice: asNumberOrUndefined(data.b),
      bidAmount: asNumberOrUndefined(data.B),
      askPrice: asNumberOrUndefined(data.a),
      askAmount: asNumberOrUndefined(data.A),
      timestamp: new Date(data.E),
      localTimestamp
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
