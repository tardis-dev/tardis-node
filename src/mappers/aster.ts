import { debug } from '../debug.ts'
import { asNumberOrUndefined, CircularBuffer, lowerCaseSymbols } from '../handy.ts'
import { BookChange, BookTicker, DerivativeTicker, Liquidation, Trade } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'
import { exchangeMappers, isRealTime } from './registry.ts'

export const asterMappers = exchangeMappers({
  aster: {
    trades: () => new AsterTradesMapper('aster'),
    bookChanges: (localTimestamp) =>
      new AsterBookChangeMapper('aster', {
        ignoreBookSnapshotOverlapError: shouldIgnoreBookSnapshotOverlap(localTimestamp)
      }),
    bookTickers: () => new AsterBookTickerMapper('aster')
  },
  'aster-futures': {
    trades: () => new AsterTradesMapper('aster-futures'),
    bookChanges: (localTimestamp) =>
      new AsterFuturesBookChangeMapper({
        ignoreBookSnapshotOverlapError: shouldIgnoreBookSnapshotOverlap(localTimestamp)
      }),
    derivativeTickers: () => new AsterFuturesDerivativeTickerMapper(),
    liquidations: () => new AsterFuturesLiquidationsMapper(),
    bookTickers: () => new AsterBookTickerMapper('aster-futures')
  }
})

function shouldIgnoreBookSnapshotOverlap(date?: Date) {
  if (process.env.IGNORE_BOOK_SNAPSHOT_OVERLAP_ERROR) {
    return true
  }

  return isRealTime(date) === false
}

class AsterTradesMapper implements Mapper<'aster' | 'aster-futures', Trade> {
  constructor(private readonly exchange: 'aster' | 'aster-futures') {}

  canHandle(message: AsterMessage<any>) {
    return message.stream?.endsWith('@trade') === true
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'trade', symbols: lowerCaseSymbols(symbols) } as const]
  }

  *map({ data }: AsterMessage<AsterTradeData>, localTimestamp: Date) {
    // Aster's Binance-compatible trade stream uses these X values for off-book
    // activity, so exclude them from normalized public trades too.
    const isOffBookTrade = data.X === 'INSURANCE_FUND' || data.X === 'ADL' || data.X === 'NA'
    if (isOffBookTrade) {
      return
    }

    const trade: Trade = {
      type: 'trade',
      symbol: data.s,
      exchange: this.exchange,
      id: String(data.t),
      price: Number(data.p),
      amount: Number(data.q),
      side: data.m ? 'sell' : 'buy',
      timestamp: new Date(data.T),
      localTimestamp
    }

    yield trade
  }
}

class AsterBookChangeMapper implements Mapper<'aster' | 'aster-futures', BookChange> {
  protected readonly symbolToDepthInfoMapping: { [key: string]: LocalDepthInfo } = {}
  protected readonly ignoreBookSnapshotOverlapError: boolean

  constructor(
    protected readonly exchange: 'aster' | 'aster-futures',
    { ignoreBookSnapshotOverlapError }: { ignoreBookSnapshotOverlapError: boolean }
  ) {
    this.ignoreBookSnapshotOverlapError = ignoreBookSnapshotOverlapError
  }

  canHandle(message: AsterMessage<any>) {
    return message.stream?.includes('@depth') === true
  }

  getFilters(symbols?: string[]) {
    return [
      { channel: 'depth', symbols: lowerCaseSymbols(symbols) } as const,
      { channel: 'depthSnapshot', symbols: lowerCaseSymbols(symbols) } as const
    ]
  }

  *map({ stream, data }: AsterMessage<AsterDepthData | AsterDepthSnapshotData>, localTimestamp: Date) {
    const symbol = stream.split('@')[0].toUpperCase()

    if (this.symbolToDepthInfoMapping[symbol] === undefined) {
      this.symbolToDepthInfoMapping[symbol] = {
        bufferedUpdates: new CircularBuffer<AsterDepthData>(2000)
      }
    }

    const symbolDepthInfo = this.symbolToDepthInfoMapping[symbol]

    if (data.lastUpdateId !== undefined) {
      if (symbolDepthInfo.snapshotProcessed) {
        return
      }

      symbolDepthInfo.lastUpdateId = data.lastUpdateId
      symbolDepthInfo.snapshotProcessed = true
      const bidsByPrice = new Map(data.bids.map((level) => [level[0], level]))
      const asksByPrice = new Map(data.asks.map((level) => [level[0], level]))

      for (const update of symbolDepthInfo.bufferedUpdates.items()) {
        const bookChange = this.mapBookDepthUpdate(update, localTimestamp)
        if (bookChange !== undefined) {
          this.applyLevelUpdates(bidsByPrice, update.b)
          this.applyLevelUpdates(asksByPrice, update.a)
        }
      }

      symbolDepthInfo.bufferedUpdates.clear()

      const bookChange: BookChange = {
        type: 'book_change',
        symbol,
        exchange: this.exchange,
        isSnapshot: true,
        bids: [...bidsByPrice.values()].map(this.mapBookLevel),
        asks: [...asksByPrice.values()].map(this.mapBookLevel),
        timestamp: data.T !== undefined ? new Date(data.T) : localTimestamp,
        localTimestamp
      }

      yield bookChange
    } else if (symbolDepthInfo.snapshotProcessed) {
      const bookChange = this.mapBookDepthUpdate(data as AsterDepthData, localTimestamp)
      if (bookChange !== undefined) {
        yield bookChange
      }
    } else {
      symbolDepthInfo.bufferedUpdates.append(data as AsterDepthData)
    }
  }

  protected mapBookDepthUpdate(depthUpdateData: AsterDepthData, localTimestamp: Date): BookChange | undefined {
    const depthContext = this.symbolToDepthInfoMapping[depthUpdateData.s]!
    const lastUpdateId = depthContext.lastUpdateId!

    if (this.isOutdatedDepthUpdate(depthUpdateData, lastUpdateId)) {
      return
    }

    if (!depthContext.validatedFirstUpdate) {
      if (this.hasInitialSnapshotOverlap(depthUpdateData, lastUpdateId) || lastUpdateId === -1) {
        depthContext.validatedFirstUpdate = true
      } else if (this.ignoreBookSnapshotOverlapError) {
        depthContext.validatedFirstUpdate = true
        debug(this.getSnapshotOverlapError(depthUpdateData, lastUpdateId))
      } else {
        throw new Error(this.getSnapshotOverlapError(depthUpdateData, lastUpdateId))
      }
    } else if (depthUpdateData.pu !== lastUpdateId) {
      throw new Error(
        `Book depth update has a sequence gap, update ${JSON.stringify(
          depthUpdateData
        )}, lastUpdateId: ${lastUpdateId}, exchange ${this.exchange}`
      )
    }

    depthContext.lastUpdateId = depthUpdateData.u

    return {
      type: 'book_change',
      symbol: depthUpdateData.s,
      exchange: this.exchange,
      isSnapshot: false,
      bids: depthUpdateData.b.map(this.mapBookLevel),
      asks: depthUpdateData.a.map(this.mapBookLevel),
      timestamp: new Date(depthUpdateData.E),
      localTimestamp
    }
  }

  protected isOutdatedDepthUpdate(depthUpdateData: AsterDepthData, lastUpdateId: number) {
    return depthUpdateData.u <= lastUpdateId
  }

  protected hasInitialSnapshotOverlap(depthUpdateData: AsterDepthData, lastUpdateId: number) {
    // Live and recorded Spot data use pu as the continuous sequence link. The
    // first non-stale update is safe when its pu..u range contains the snapshot.
    return depthUpdateData.pu <= lastUpdateId && depthUpdateData.u >= lastUpdateId
  }

  private applyLevelUpdates(levelsByPrice: Map<string, AsterBookLevel>, updates: AsterBookLevel[]) {
    for (const level of updates) {
      if (Number(level[1]) === 0) {
        levelsByPrice.delete(level[0])
      } else {
        levelsByPrice.set(level[0], level)
      }
    }
  }

  private getSnapshotOverlapError(depthUpdateData: AsterDepthData, lastUpdateId: number) {
    return `Book depth snapshot has no overlap with first update, update ${JSON.stringify(
      depthUpdateData
    )}, lastUpdateId: ${lastUpdateId}, exchange ${this.exchange}`
  }

  private mapBookLevel(level: AsterBookLevel) {
    return {
      price: Number(level[0]),
      amount: Number(level[1])
    }
  }
}

class AsterBookTickerMapper implements Mapper<'aster' | 'aster-futures', BookTicker> {
  constructor(private readonly exchange: 'aster' | 'aster-futures') {}

  canHandle(message: AsterMessage<any>) {
    return message.stream?.endsWith('@bookTicker') === true
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'bookTicker', symbols: lowerCaseSymbols(symbols) } as const]
  }

  *map({ data }: AsterMessage<AsterBookTickerData>, localTimestamp: Date) {
    const ticker: BookTicker = {
      type: 'book_ticker',
      symbol: data.s,
      exchange: this.exchange,
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

class AsterFuturesBookChangeMapper extends AsterBookChangeMapper {
  constructor({ ignoreBookSnapshotOverlapError }: { ignoreBookSnapshotOverlapError: boolean }) {
    super('aster-futures', { ignoreBookSnapshotOverlapError })
  }

  protected override isOutdatedDepthUpdate(depthUpdateData: AsterDepthData, lastUpdateId: number) {
    return depthUpdateData.u < lastUpdateId
  }

  protected override hasInitialSnapshotOverlap(depthUpdateData: AsterDepthData, lastUpdateId: number) {
    // Futures normally contains the snapshot id in U..u, but live and recorded
    // data also continues it directly with pu == lastUpdateId. Exact-id partial
    // depth and bookTicker comparisons confirmed that neither form skips a state.
    return (depthUpdateData.U <= lastUpdateId && depthUpdateData.u >= lastUpdateId) || depthUpdateData.pu === lastUpdateId
  }
}

class AsterFuturesDerivativeTickerMapper implements Mapper<'aster-futures', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: AsterMessage<any>) {
    return (
      message.stream?.includes('@markPrice') === true ||
      message.stream?.endsWith('@ticker') === true ||
      message.stream?.endsWith('@openInterest') === true
    )
  }

  getFilters(symbols?: string[]) {
    const normalizedSymbols = lowerCaseSymbols(symbols)

    return [
      { channel: 'markPrice', symbols: normalizedSymbols } as const,
      { channel: 'ticker', symbols: normalizedSymbols } as const,
      { channel: 'openInterest', symbols: normalizedSymbols } as const
    ]
  }

  *map(
    { data }: AsterMessage<AsterFuturesMarkPriceData | AsterFuturesTickerData | AsterFuturesOpenInterestData>,
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
  canHandle(message: AsterMessage<any>) {
    return message.stream?.endsWith('@forceOrder') === true
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'forceOrder', symbols: lowerCaseSymbols(symbols) } as const]
  }

  *map({ data }: AsterMessage<AsterFuturesForceOrderData>, localTimestamp: Date) {
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

type AsterMessage<T> = {
  stream: string
  data: T
}

type AsterTradeData = {
  e: 'trade'
  s: string
  t: number
  p: string
  q: string
  T: number
  m: boolean
  X?: 'INSURANCE_FUND' | 'MARKET' | 'ADL' | 'NA'
}

type AsterDepthData = {
  lastUpdateId: undefined
  E: number
  T: number
  s: string
  U: number
  u: number
  pu: number
  b: AsterBookLevel[]
  a: AsterBookLevel[]
}

type AsterDepthSnapshotData = {
  lastUpdateId: number
  bids: AsterBookLevel[]
  asks: AsterBookLevel[]
  T?: number
}

type AsterBookLevel = [string, string]

type LocalDepthInfo = {
  bufferedUpdates: CircularBuffer<AsterDepthData>
  snapshotProcessed?: boolean
  lastUpdateId?: number
  validatedFirstUpdate?: boolean
}

type AsterBookTickerData = {
  u: number
  s: string
  b: string
  B: string
  a: string
  A: string
  E?: number
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

type AsterFuturesOpenInterestData = {
  symbol: string
  openInterest: string
  time: number
}
