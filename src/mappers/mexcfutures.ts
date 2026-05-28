import { asNonZeroNumberOrUndefined, CircularBuffer, upperCaseSymbols } from '../handy.ts'
import { BookChange, BookTicker, DerivativeTicker, Trade } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'

export class MexcFuturesTradesMapper implements Mapper<'mexc-futures', Trade> {
  canHandle(message: MexcFuturesDealMessage) {
    return message.channel === 'push.deal'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'push.deal', symbols: upperCaseSymbols(symbols) } as const]
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
  private readonly symbolDepthInfo: { [symbol: string]: MexcFuturesDepthInfo } = {}

  canHandle(message: MexcFuturesDepthMessage) {
    return message.channel === 'push.depth'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'push.depth', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: MexcFuturesDepthMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const depthInfo = this.getSymbolDepthInfo(message.symbol)
    if (message.generated === true) {
      if (depthInfo.snapshotEmitted) {
        return
      }

      for (const update of depthInfo.updates.items()) {
        if (message.data.version + 1 < update.data.begin || message.data.version >= update.data.end) {
          continue
        }
        for (const bid of update.data.bids) {
          this.applyLevel(message.data.bids, bid)
        }
        for (const ask of update.data.asks) {
          this.applyLevel(message.data.asks, ask)
        }
        message.data.version = update.data.end
      }
      depthInfo.updates.clear()
      depthInfo.currentBookVersion = message.data.version
      depthInfo.snapshotEmitted = true

      yield {
        type: 'book_change',
        symbol: message.symbol,
        exchange: 'mexc-futures',
        isSnapshot: true,
        bids: message.data.bids.map(this.mapBookLevel),
        asks: message.data.asks.map(this.mapBookLevel),
        timestamp: new Date(message.ts),
        localTimestamp
      }

      return
    }

    if (!depthInfo.snapshotEmitted) {
      depthInfo.updates.append(message)
      return
    }

    if (message.data.end <= depthInfo.currentBookVersion!) {
      return
    }

    if (!depthInfo.isContinuityValidated) {
      if (message.data.begin > depthInfo.currentBookVersion! + 1 || message.data.end < depthInfo.currentBookVersion! + 1) {
        throw new Error(
          `MEXC futures depth snapshot has no overlap with first update, update ${JSON.stringify(message)}, currentBookVersion: ${
            depthInfo.currentBookVersion
          }`
        )
      }

      depthInfo.isContinuityValidated = true
    }

    depthInfo.currentBookVersion = message.data.end

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

  private applyLevel(bookSide: MexcFuturesDepthLevel[], levelUpdate: MexcFuturesDepthLevel) {
    const existingIndex = bookSide.findIndex((level) => level[0] === levelUpdate[0])
    if (levelUpdate[2] === 0) {
      if (existingIndex !== -1) {
        bookSide.splice(existingIndex, 1)
      }
      return
    }

    if (existingIndex === -1) {
      bookSide.push(levelUpdate)
    } else {
      bookSide[existingIndex] = levelUpdate
    }
  }

  private mapBookLevel(level: MexcFuturesDepthLevel) {
    return {
      price: level[0],
      amount: level[2]
    }
  }

  private getSymbolDepthInfo(symbol: string) {
    if (this.symbolDepthInfo[symbol] === undefined) {
      this.symbolDepthInfo[symbol] = { updates: new CircularBuffer<MexcFuturesDepthUpdateMessage>(2000) }
    }

    return this.symbolDepthInfo[symbol]
  }
}

export class MexcFuturesBookTickerMapper implements Mapper<'mexc-futures', BookTicker> {
  canHandle(message: MexcFuturesTickerMessage) {
    return message.channel === 'push.ticker'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'push.ticker', symbols: upperCaseSymbols(symbols) } as const]
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
      { channel: 'push.ticker', symbols: normalizedSymbols } as const,
      { channel: 'push.index.price', symbols: normalizedSymbols } as const,
      { channel: 'push.fair.price', symbols: normalizedSymbols } as const
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

type MexcFuturesDepthMessage = MexcFuturesDepthSnapshotMessage | MexcFuturesDepthUpdateMessage

type MexcFuturesDepthInfo = {
  isContinuityValidated?: boolean
  currentBookVersion?: number
  snapshotEmitted?: boolean
  updates: CircularBuffer<MexcFuturesDepthUpdateMessage>
}

type MexcFuturesDepthSnapshotMessage = MexcFuturesMessage<
  'push.depth',
  {
    asks: MexcFuturesDepthLevel[]
    bids: MexcFuturesDepthLevel[]
    version: number
  }
> & { generated: true }

type MexcFuturesDepthUpdateMessage = MexcFuturesMessage<
  'push.depth',
  {
    asks: MexcFuturesDepthLevel[]
    bids: MexcFuturesDepthLevel[]
    begin: number
    end: number
    version: number
  }
> & { generated?: undefined }

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
