import { upperCaseSymbols } from '../handy'
import { BookChange, Exchange, BookTicker, Trade } from '../types'
import { Mapper } from './mapper'

export class BybitSpotTradesMapper implements Mapper<'bybit-spot', Trade> {
  constructor(private readonly _exchange: Exchange) {}
  canHandle(message: BybitSpotTradeMessage) {
    return message.topic === 'trade' && message.data !== undefined
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trade',
        symbols
      } as const
    ]
  }

  *map(message: BybitSpotTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    const bybitTrade = message.data
    yield {
      type: 'trade',
      symbol: message.params.symbol,
      exchange: this._exchange,
      id: bybitTrade.v,
      price: Number(bybitTrade.p),
      amount: Number(bybitTrade.q),
      side: bybitTrade.m === true ? 'buy' : 'sell',
      timestamp: new Date(bybitTrade.t),
      localTimestamp
    }
  }
}

export class BybitSpotBookChangeMapper implements Mapper<'bybit-spot', BookChange> {
  constructor(protected readonly _exchange: Exchange) {}

  canHandle(message: BybitSpotDepthMessage) {
    return message.topic === 'depth' && message.data !== undefined
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'depth',
        symbols
      } as const
    ]
  }

  *map(message: BybitSpotDepthMessage, localTimestamp: Date) {
    yield {
      type: 'book_change',
      symbol: message.params.symbol,
      exchange: this._exchange,
      isSnapshot: true,
      bids: message.data.b.map(this._mapBookLevel),
      asks: message.data.a.map(this._mapBookLevel),
      timestamp: new Date(message.data.t),
      localTimestamp
    } as const
  }

  private _mapBookLevel(level: [string, string]) {
    return { price: Number(level[0]), amount: Number(level[1]) }
  }
}

export class BybitSpotBookTickerMapper implements Mapper<'bybit-spot', BookTicker> {
  constructor(protected readonly _exchange: Exchange) {}

  canHandle(message: BybitSpotBookTickerMessage) {
    return message.topic === 'bookTicker' && message.data !== undefined
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'bookTicker',
        symbols
      } as const
    ]
  }

  *map(message: BybitSpotBookTickerMessage, localTimestamp: Date) {
    const bookTicker: BookTicker = {
      type: 'book_ticker',
      symbol: message.params.symbol,
      exchange: this._exchange,
      askAmount: message.data.askQty !== undefined ? Number(message.data.askQty) : undefined,
      askPrice: message.data.askPrice !== undefined ? Number(message.data.askPrice) : undefined,
      bidPrice: message.data.bidPrice !== undefined ? Number(message.data.bidPrice) : undefined,
      bidAmount: message.data.bidQty !== undefined ? Number(message.data.bidQty) : undefined,
      timestamp: new Date(message.data.time),
      localTimestamp: localTimestamp
    }

    yield bookTicker
  }
}

type BybitSpotBookTickerMessage = {
  topic: 'bookTicker'
  params: { symbol: 'BATUSDT'; binary: 'false'; symbolName: 'BATUSDT' }
  data: { symbol: 'BATUSDT'; bidPrice: '0.3985'; bidQty: '1919.99'; askPrice: '0.3997'; askQty: '3747.68'; time: 1659311999973 }
}

type BybitSpotTradeMessage = {
  topic: 'trade'
  params: { symbol: 'XRP3SUSDT'; binary: 'false'; symbolName: 'XRP3SUSDT' }
  data: { v: '2220000000006443832'; t: 1659312000387; p: '6.3957'; q: '3.5962'; m: boolean }
}

type BybitSpotDepthMessage = {
  topic: 'depth'
  params: { symbol: 'RENUSDT'; binary: 'false'; symbolName: 'RENUSDT' }
  data: {
    s: 'RENUSDT'
    t: 1659312000390
    v: '170667316_8244371_5'
    b: [['0.14348', '3249.63']]
    a: [['0.14457', '95.23']]
  }
}
