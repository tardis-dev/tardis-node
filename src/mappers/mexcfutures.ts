import { asNonZeroNumberOrUndefined, upperCaseSymbols } from '../handy.ts'
import { BookChange, BookTicker, DerivativeTicker, Trade } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'

export class MexcFuturesTradesMapper implements Mapper<'mexc-futures', Trade> {
  canHandle(message: MexcFuturesDealMessage) {
    return message.channel === 'push.deal'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'sub.deal', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: MexcFuturesDealMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const trade of message.data) {
      yield {
        type: 'trade',
        symbol: message.symbol,
        exchange: 'mexc-futures',
        id: trade.i,
        price: trade.p,
        amount: trade.v,
        side: trade.T === MexcFuturesTradeSide.Buy ? 'buy' : 'sell',
        timestamp: new Date(trade.t),
        localTimestamp
      }
    }
  }
}

export class MexcFuturesBookChangeMapper implements Mapper<'mexc-futures', BookChange> {
  canHandle(message: MexcFuturesDepthMessage) {
    return message.channel === 'push.depth'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'sub.depth', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: MexcFuturesDepthMessage, localTimestamp: Date): IterableIterator<BookChange> {
    yield {
      type: 'book_change',
      symbol: message.symbol,
      exchange: 'mexc-futures',
      isSnapshot: false,
      bids: message.data.bids.map(this.mapBookLevel),
      asks: message.data.asks.map(this.mapBookLevel),
      timestamp: new Date(message.ts),
      localTimestamp
    }
  }

  private mapBookLevel(level: MexcFuturesDepthLevel) {
    return {
      price: level[0],
      amount: level[2]
    }
  }
}

export class MexcFuturesBookTickerMapper implements Mapper<'mexc-futures', BookTicker> {
  canHandle(message: MexcFuturesTickerMessage) {
    return message.channel === 'push.ticker'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'sub.ticker', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: MexcFuturesTickerMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    yield {
      type: 'book_ticker',
      symbol: message.symbol,
      exchange: 'mexc-futures',
      askPrice: asNonZeroNumberOrUndefined(message.data.ask1),
      askAmount: undefined,
      bidPrice: asNonZeroNumberOrUndefined(message.data.bid1),
      bidAmount: undefined,
      timestamp: new Date(message.data.timestamp),
      localTimestamp
    }
  }
}

export class MexcFuturesDerivativeTickerMapper implements Mapper<'mexc-futures', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: MexcFuturesTickerMessage | MexcFuturesIndexPriceMessage | MexcFuturesFairPriceMessage) {
    return message.channel === 'push.ticker' || message.channel === 'push.index.price' || message.channel === 'push.fair.price'
  }

  getFilters(symbols?: string[]) {
    const normalizedSymbols = upperCaseSymbols(symbols)

    return [
      { channel: 'sub.ticker', symbols: normalizedSymbols } as const,
      { channel: 'sub.index.price', symbols: normalizedSymbols } as const,
      { channel: 'sub.fair.price', symbols: normalizedSymbols } as const
    ]
  }

  *map(
    message: MexcFuturesTickerMessage | MexcFuturesIndexPriceMessage | MexcFuturesFairPriceMessage,
    localTimestamp: Date
  ): IterableIterator<DerivativeTicker> {
    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.symbol, 'mexc-futures')

    if (message.channel === 'push.index.price') {
      pendingTickerInfo.updateIndexPrice(message.data.price)
      pendingTickerInfo.updateTimestamp(new Date(message.ts))
      return
    }

    if (message.channel === 'push.fair.price') {
      pendingTickerInfo.updateMarkPrice(message.data.price)
      pendingTickerInfo.updateTimestamp(new Date(message.ts))
      return
    }

    pendingTickerInfo.updateLastPrice(message.data.lastPrice)
    pendingTickerInfo.updateOpenInterest(message.data.holdVol)
    pendingTickerInfo.updateFundingRate(message.data.fundingRate)
    pendingTickerInfo.updateIndexPrice(message.data.indexPrice)
    pendingTickerInfo.updateMarkPrice(message.data.fairPrice)
    pendingTickerInfo.updateTimestamp(new Date(message.data.timestamp))

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

const MEXC_FUTURES_PUSH_CHANNELS = ['push.deal', 'push.depth', 'push.ticker', 'push.index.price', 'push.fair.price'] as const
type MexcFuturesPushChannel = (typeof MEXC_FUTURES_PUSH_CHANNELS)[number]
type MexcFuturesMessage<TChannel extends MexcFuturesPushChannel, TData> = {
  channel: TChannel
  symbol: string
  ts: number
  data: TData
}

type MexcFuturesDealMessage = MexcFuturesMessage<
  'push.deal',
  {
    p: number
    v: number
    T: MexcFuturesTradeSide
    O: MexcFuturesOpenCloseFlag
    M: MexcFuturesSelfTrade
    t: number
    i: string
  }[]
>

enum MexcFuturesTradeSide {
  Buy = 1,
  Sell = 2
}
enum MexcFuturesOpenCloseFlag {
  NewPosition = 1,
  ReducePosition = 2,
  Unchanged = 3
}
enum MexcFuturesSelfTrade {
  Yes = 1,
  No = 2
}

type MexcFuturesDepthMessage = MexcFuturesMessage<
  'push.depth',
  {
    asks: MexcFuturesDepthLevel[]
    bids: MexcFuturesDepthLevel[]
    version: number
  }
>

type MexcFuturesDepthLevel = [price: number, ordersCount: number, quantity: number]

type MexcFuturesTickerMessage = MexcFuturesMessage<
  'push.ticker',
  {
    ask1: number
    bid1: number
    contractId: number
    fairPrice: number
    fundingRate: number
    high24Price: number
    indexPrice: number
    lastPrice: number
    lower24Price: number
    maxBidPrice: number
    minAskPrice: number
    riseFallRate: number
    riseFallValue: number
    symbol: string
    timestamp: number
    holdVol: number
    volume24: number
    amount24?: number
  }
>

type MexcFuturesIndexPriceMessage = MexcFuturesMessage<'push.index.price', MexcFuturesPriceData>
type MexcFuturesFairPriceMessage = MexcFuturesMessage<'push.fair.price', MexcFuturesPriceData>

type MexcFuturesPriceData = {
  price: number
  symbol: string
}
