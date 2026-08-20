import { debug } from '../debug.ts'
import { asNumberOrUndefined, CircularBuffer, lowerCaseSymbols } from '../handy.ts'
import type { AsterFuturesOpenInterestData } from '../realtimefeeds/aster.ts'
import { BookChange, BookTicker, DerivativeTicker, Liquidation, Trade } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'
import { exchangeMappers, isRealTime } from './registry.ts'

export const asterFuturesMappers = exchangeMappers({
  'aster-futures': {
    trades: () => new AsterFuturesTradesMapper(),
    bookChanges: (localTimestamp) =>
      new AsterFuturesBookChangeMapper({
        ignoreBookSnapshotOverlapError: shouldIgnoreBookSnapshotOverlap(localTimestamp)
      }),
    derivativeTickers: () => new AsterFuturesDerivativeTickerMapper(),
    liquidations: () => new AsterFuturesLiquidationsMapper(),
    bookTickers: () => new AsterFuturesBookTickerMapper()
  }
})

function shouldIgnoreBookSnapshotOverlap(date?: Date) {
  if (process.env.IGNORE_BOOK_SNAPSHOT_OVERLAP_ERROR) {
    return true
  }

  return isRealTime(date) === false
}

class AsterFuturesTradesMapper implements Mapper<'aster-futures', Trade> {
  canHandle(message: AsterFuturesMessage<any>) {
    return message.stream?.endsWith('@trade') === true || message.stream?.endsWith('@aggTrade') === true
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'trade', symbols: lowerCaseSymbols(symbols) } as const]
  }

  *map({ data }: AsterFuturesMessage<AsterFuturesTradeData | AsterFuturesAggTradeData>, localTimestamp: Date) {
    const trade: Trade = {
      type: 'trade',
      symbol: data.s,
      exchange: 'aster-futures',
      id: String(data.e === 'trade' ? data.t : data.a),
      price: Number(data.p),
      amount: Number(data.q),
      side: data.m ? 'sell' : 'buy',
      timestamp: new Date(data.T),
      localTimestamp
    }

    yield trade
  }
}

class AsterFuturesBookChangeMapper implements Mapper<'aster-futures', BookChange> {
  private readonly symbolToDepthInfoMapping: { [key: string]: LocalDepthInfo } = {}
  private readonly ignoreBookSnapshotOverlapError: boolean

  constructor({ ignoreBookSnapshotOverlapError }: { ignoreBookSnapshotOverlapError: boolean }) {
    this.ignoreBookSnapshotOverlapError = ignoreBookSnapshotOverlapError
  }

  canHandle(message: AsterFuturesMessage<any>) {
    return message.stream?.includes('@depth') === true
  }

  getFilters(symbols?: string[]) {
    return [
      { channel: 'depth', symbols: lowerCaseSymbols(symbols) } as const,
      { channel: 'depthSnapshot', symbols: lowerCaseSymbols(symbols) } as const
    ]
  }

  *map({ stream, data }: AsterFuturesMessage<AsterFuturesDepthData | AsterFuturesDepthSnapshotData>, localTimestamp: Date) {
    const symbol = stream.split('@')[0].toUpperCase()

    if (this.symbolToDepthInfoMapping[symbol] === undefined) {
      this.symbolToDepthInfoMapping[symbol] = {
        bufferedUpdates: new CircularBuffer<AsterFuturesDepthData>(2000)
      }
    }

    const symbolDepthInfo = this.symbolToDepthInfoMapping[symbol]
    if (data.lastUpdateId !== undefined) {
      if (symbolDepthInfo.snapshotProcessed) {
        return
      }

      symbolDepthInfo.lastUpdateId = data.lastUpdateId
      symbolDepthInfo.snapshotProcessed = true

      for (const update of symbolDepthInfo.bufferedUpdates.items()) {
        const bookChange = this.mapBookDepthUpdate(update, localTimestamp)
        if (bookChange !== undefined) {
          for (const bid of update.b) {
            const matchingBid = data.bids.find((b) => b[0] === bid[0])
            if (matchingBid !== undefined) {
              matchingBid[1] = bid[1]
            } else {
              data.bids.push(bid)
            }
          }

          for (const ask of update.a) {
            const matchingAsk = data.asks.find((a) => a[0] === ask[0])
            if (matchingAsk !== undefined) {
              matchingAsk[1] = ask[1]
            } else {
              data.asks.push(ask)
            }
          }
        }
      }

      symbolDepthInfo.bufferedUpdates.clear()

      const bookChange: BookChange = {
        type: 'book_change',
        symbol,
        exchange: 'aster-futures',
        isSnapshot: true,
        bids: data.bids.map(this.mapBookLevel),
        asks: data.asks.map(this.mapBookLevel),
        timestamp: data.T !== undefined ? new Date(data.T) : localTimestamp,
        localTimestamp
      }

      yield bookChange
    } else if (symbolDepthInfo.snapshotProcessed) {
      const bookChange = this.mapBookDepthUpdate(data as AsterFuturesDepthData, localTimestamp)
      if (bookChange !== undefined) {
        yield bookChange
      }
    } else {
      symbolDepthInfo.bufferedUpdates.append(data as AsterFuturesDepthData)
    }
  }

  private mapBookDepthUpdate(depthUpdateData: AsterFuturesDepthData, localTimestamp: Date): BookChange | undefined {
    const depthContext = this.symbolToDepthInfoMapping[depthUpdateData.s]!

    if (depthUpdateData.u < depthContext.lastUpdateId!) {
      return
    }

    if (!depthContext.validatedFirstUpdate) {
      if (depthUpdateData.U <= depthContext.lastUpdateId! && depthUpdateData.u >= depthContext.lastUpdateId!) {
        depthContext.validatedFirstUpdate = true
      } else if (this.ignoreBookSnapshotOverlapError) {
        depthContext.validatedFirstUpdate = true
        debug(
          `Book depth snaphot has no overlap with first update, update ${JSON.stringify(
            depthUpdateData
          )}, lastUpdateId: ${depthContext.lastUpdateId!}, exchange aster-futures`
        )
      } else {
        throw new Error(
          `Book depth snaphot has no overlap with first update, update ${JSON.stringify(
            depthUpdateData
          )}, lastUpdateId: ${depthContext.lastUpdateId!}, exchange aster-futures`
        )
      }
    } else if (depthUpdateData.pu !== depthContext.lastUpdateId!) {
      throw new Error(
        `Book depth update has a sequence gap, update ${JSON.stringify(
          depthUpdateData
        )}, lastUpdateId: ${depthContext.lastUpdateId!}, exchange aster-futures`
      )
    }

    depthContext.lastUpdateId = depthUpdateData.u

    return {
      type: 'book_change',
      symbol: depthUpdateData.s,
      exchange: 'aster-futures',
      isSnapshot: false,
      bids: depthUpdateData.b.map(this.mapBookLevel),
      asks: depthUpdateData.a.map(this.mapBookLevel),
      timestamp: new Date(depthUpdateData.E),
      localTimestamp
    }
  }

  private mapBookLevel(level: AsterFuturesBookLevel) {
    return {
      price: Number(level[0]),
      amount: Number(level[1])
    }
  }
}

class AsterFuturesDerivativeTickerMapper implements Mapper<'aster-futures', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: AsterFuturesMessage<any>) {
    return (
      message.stream?.includes('@markPrice') === true ||
      message.stream?.endsWith('@ticker') === true ||
      message.stream?.endsWith('@openInterest') === true
    )
  }

  getFilters(symbols?: string[]) {
    return [
      { channel: 'markPrice', symbols: lowerCaseSymbols(symbols) } as const,
      { channel: 'ticker', symbols: lowerCaseSymbols(symbols) } as const,
      { channel: 'openInterest', symbols: lowerCaseSymbols(symbols) } as const
    ]
  }

  *map(
    { data }: AsterFuturesMessage<AsterFuturesMarkPriceData | AsterFuturesTickerData | AsterFuturesOpenInterestData>,
    localTimestamp: Date
  ): IterableIterator<DerivativeTicker> {
    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo('s' in data ? data.s : data.symbol, 'aster-futures')

    if ('e' in data) {
      if (data.e === 'markPriceUpdate') {
        pendingTickerInfo.updateMarkPrice(Number(data.p))
        if (data.i !== undefined) {
          pendingTickerInfo.updateIndexPrice(Number(data.i))
        }
        if (data.r !== '' && data.T !== 0) {
          pendingTickerInfo.updateFundingRate(Number(data.r))
          pendingTickerInfo.updateFundingTimestamp(new Date(data.T))
        }
        pendingTickerInfo.updateTimestamp(new Date(data.E))
      }

      if (data.e === '24hrTicker') {
        pendingTickerInfo.updateLastPrice(Number(data.c))
        pendingTickerInfo.updateTimestamp(new Date(data.E))
      }
    } else if ('openInterest' in data) {
      pendingTickerInfo.updateOpenInterest(Number(data.openInterest))
      pendingTickerInfo.updateTimestamp(new Date(data.time))
    }

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

class AsterFuturesLiquidationsMapper implements Mapper<'aster-futures', Liquidation> {
  canHandle(message: AsterFuturesMessage<any>) {
    return message.stream?.endsWith('@forceOrder') === true
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'forceOrder', symbols: lowerCaseSymbols(symbols) } as const]
  }

  *map({ data }: AsterFuturesMessage<AsterFuturesForceOrderData>, localTimestamp: Date) {
    const order = data.o
    if (order.X !== 'FILLED') {
      return
    }

    const liquidation: Liquidation = {
      type: 'liquidation',
      symbol: order.s,
      exchange: 'aster-futures',
      id: undefined,
      price: Number(order.p),
      amount: Number(order.z),
      side: order.S === 'SELL' ? 'sell' : 'buy',
      timestamp: new Date(order.T),
      localTimestamp
    }

    yield liquidation
  }
}

class AsterFuturesBookTickerMapper implements Mapper<'aster-futures', BookTicker> {
  canHandle(message: AsterFuturesMessage<any>) {
    return message.stream?.endsWith('@bookTicker') === true
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'bookTicker', symbols: lowerCaseSymbols(symbols) } as const]
  }

  *map({ data }: AsterFuturesMessage<AsterFuturesBookTickerData>, localTimestamp: Date) {
    const ticker: BookTicker = {
      type: 'book_ticker',
      symbol: data.s,
      exchange: 'aster-futures',
      askAmount: asNumberOrUndefined(data.A),
      askPrice: asNumberOrUndefined(data.a),
      bidPrice: asNumberOrUndefined(data.b),
      bidAmount: asNumberOrUndefined(data.B),
      timestamp: data.E !== undefined ? new Date(data.E) : localTimestamp,
      localTimestamp
    }

    yield ticker
  }
}

type AsterFuturesMessage<T> = {
  stream: string
  data: T
}

type AsterFuturesAggTradeData = {
  e: 'aggTrade'
  E: number
  s: string
  a: number
  p: string
  q: string
  f: number
  l: number
  T: number
  m: boolean
}

type AsterFuturesTradeData = {
  e: 'trade'
  E: number
  s: string
  t: number
  p: string
  q: string
  T: number
  m: boolean
}

type AsterFuturesDepthData = {
  lastUpdateId: undefined
  E: number
  T: number
  s: string
  U: number
  u: number
  pu: number
  b: AsterFuturesBookLevel[]
  a: AsterFuturesBookLevel[]
}

type AsterFuturesDepthSnapshotData = {
  lastUpdateId: number
  bids: AsterFuturesBookLevel[]
  asks: AsterFuturesBookLevel[]
  T?: number
}

type AsterFuturesBookLevel = [string, string]

type LocalDepthInfo = {
  bufferedUpdates: CircularBuffer<AsterFuturesDepthData>
  snapshotProcessed?: boolean
  lastUpdateId?: number
  validatedFirstUpdate?: boolean
}

type AsterFuturesTickerData = {
  e: '24hrTicker'
  E: number
  s: string
  c: string
}

type AsterFuturesMarkPriceData = {
  e: 'markPriceUpdate'
  E: number
  s: string
  p: string
  i?: string
  r: string
  T: number
}

type AsterFuturesForceOrderData = {
  e: 'forceOrder'
  E: number
  o: {
    s: string
    S: 'BUY' | 'SELL'
    p: string
    X: string
    z: string
    T: number
  }
}

type AsterFuturesBookTickerData = {
  u: number
  s: string
  b: string
  B: string
  a: string
  A: string
  E?: number
}
