import { asNumberOrUndefined, CircularBuffer, fromMicroSecondsToDate } from '../handy.ts'
import { BookChange, BookTicker, DerivativeTicker, Liquidation, Trade } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'
import { exchangeMappers, isRealTime } from './registry.ts'

export const backpackMappers = exchangeMappers({
  backpack: {
    trades: () => new BackpackTradesMapper(),
    bookChanges: (localTimestamp) => new BackpackBookChangeMapper(isRealTime(localTimestamp)),
    bookTickers: () => new BackpackBookTickerMapper(),
    derivativeTickers: () => new BackpackDerivativeTickerMapper(),
    liquidations: () => new BackpackLiquidationsMapper()
  }
})

class BackpackTradesMapper implements Mapper<'backpack', Trade> {
  canHandle(message: BackpackMessage<unknown>) {
    return message.stream?.startsWith('trade.') === true
  }

  getFilters(symbols: string[] = []) {
    return [{ channel: 'trade', symbols } as const]
  }

  *map({ data }: BackpackTradeMessage, localTimestamp: Date) {
    yield {
      type: 'trade',
      symbol: data.s.toUpperCase(),
      exchange: 'backpack',
      id: String(data.t),
      price: Number(data.p),
      amount: Number(data.q),
      side: data.m ? 'sell' : 'buy',
      timestamp: fromMicroSecondsToDate(data.T),
      localTimestamp
    } as const
  }
}

class BackpackBookChangeMapper implements Mapper<'backpack', BookChange> {
  private readonly bookStates = new Map<string, BackpackBookState>()

  constructor(private readonly validateSequences: boolean) {}

  canHandle(message: BackpackMessage<unknown>) {
    return message.stream?.startsWith('depth.') === true || message.stream?.startsWith('depthSnapshot.') === true
  }

  getFilters(symbols: string[] = []) {
    return [{ channel: 'depth', symbols } as const, { channel: 'depthSnapshot', symbols } as const]
  }

  *map({ stream, data }: BackpackDepthMessage | BackpackSnapshotMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const symbol = stream.slice(stream.indexOf('.') + 1)

    let bookState = this.bookStates.get(symbol)
    if (bookState === undefined) {
      bookState = { buffered: new CircularBuffer(2000) }
      this.bookStates.set(symbol, bookState)
    }

    if ('lastUpdateId' in data) {
      if (bookState.sequence !== undefined) {
        return
      }

      // Bound memory while waiting, but never silently lose updates needed after this snapshot.
      if (bookState.discardedThrough !== undefined && Number(data.lastUpdateId) < bookState.discardedThrough) {
        throw new Error(`Backpack snapshot for ${symbol} does not cover discarded buffered updates`)
      }
      bookState.sequence = Number(data.lastUpdateId)
      // REST snapshot prices drop trailing zeros ("74.8") while depth prices keep them ("74.80"), so match levels by number.
      const bidsByPrice = new Map(data.bids.map((level) => [Number(level[0]), level]))
      const asksByPrice = new Map(data.asks.map((level) => [Number(level[0]), level]))

      // Updates received before the snapshot are applied to it, so output starts with one current book
      // and never goes back in local time.
      for (const update of bookState.buffered.items()) {
        if (this.advanceSequence(update, bookState)) {
          this.applyLevelUpdates(bidsByPrice, update.b)
          this.applyLevelUpdates(asksByPrice, update.a)
        }
      }

      bookState.buffered.clear()

      yield {
        type: 'book_change',
        exchange: 'backpack',
        symbol: symbol.toUpperCase(),
        isSnapshot: true,
        bids: [...bidsByPrice.values()].map(this.mapLevel),
        asks: [...asksByPrice.values()].map(this.mapLevel),
        timestamp: fromMicroSecondsToDate(data.timestamp),
        localTimestamp
      }
    } else if (bookState.sequence === undefined) {
      const discarded = bookState.buffered.append(data)
      if (discarded !== undefined) bookState.discardedThrough = discarded.u
    } else if (this.advanceSequence(data, bookState)) {
      yield this.mapUpdate(data, localTimestamp)
    }
  }

  private advanceSequence(data: BackpackDepthMessage['data'], bookState: BackpackBookState) {
    if (data.u <= bookState.sequence!) {
      return false
    }

    if (this.validateSequences && (data.U <= bookState.sequence! + 1 && data.u >= bookState.sequence! + 1) == false) {
      throw new Error(`Backpack depth sequence gap for ${data.s}: expected ${bookState.sequence! + 1}, received ${data.U}-${data.u}`)
    }
    bookState.sequence = data.u
    return true
  }

  private applyLevelUpdates(levelsByPrice: Map<number, [string, string]>, updates: BackpackLevels) {
    for (const level of updates) {
      const price = Number(level[0])
      if (Number(level[1]) === 0) {
        levelsByPrice.delete(price)
      } else {
        levelsByPrice.set(price, level)
      }
    }
  }

  private mapUpdate(data: BackpackDepthMessage['data'], localTimestamp: Date): BookChange {
    return {
      type: 'book_change',
      exchange: 'backpack',
      symbol: data.s.toUpperCase(),
      isSnapshot: false,
      bids: data.b.map(this.mapLevel),
      asks: data.a.map(this.mapLevel),
      timestamp: fromMicroSecondsToDate(data.E),
      localTimestamp
    }
  }
  private mapLevel([price, amount]: [string, string]) {
    return {
      price: Number(price),
      amount: Number(amount)
    }
  }
}

class BackpackBookTickerMapper implements Mapper<'backpack', BookTicker> {
  canHandle(message: BackpackMessage<unknown>) {
    return message.stream?.startsWith('bookTicker.') === true
  }
  getFilters(symbols: string[] = []) {
    return [{ channel: 'bookTicker', symbols } as const]
  }
  *map({ data }: BackpackBookTickerMessage, localTimestamp: Date) {
    yield {
      type: 'book_ticker',
      exchange: 'backpack',
      symbol: data.s.toUpperCase(),
      askPrice: asNumberOrUndefined(data.a),
      askAmount: asNumberOrUndefined(data.A),
      bidPrice: asNumberOrUndefined(data.b),
      bidAmount: asNumberOrUndefined(data.B),
      timestamp: fromMicroSecondsToDate(data.E),
      localTimestamp
    } as const
  }
}

class BackpackDerivativeTickerMapper implements Mapper<'backpack', DerivativeTicker> {
  private readonly pending = new PendingTickerInfoHelper()

  canHandle(message: BackpackMessage<unknown>) {
    return /^(markPrice|openInterest|ticker)\./.test(message.stream)
  }

  getFilters(symbols: string[] = []) {
    return [
      { channel: 'markPrice', symbols } as const,
      { channel: 'openInterest', symbols } as const,
      { channel: 'ticker', symbols } as const
    ]
  }

  *map(
    { stream, data }: BackpackTickerMessage | BackpackMarkPriceMessage | BackpackOpenInterestMessage,
    localTimestamp: Date
  ): IterableIterator<DerivativeTicker> {
    const ticker = this.pending.getPendingTickerInfo(data.s.toUpperCase(), 'backpack')

    // Ticker and open interest update cached state. markPrice owns output and its
    // microsecond event timestamp, avoiding regressions between independent channels.
    if (stream.startsWith('openInterest.')) {
      ticker.updateOpenInterest(asNumberOrUndefined((data as BackpackOpenInterestMessage['data']).o))
      return
    }

    if (stream.startsWith('ticker.')) {
      ticker.updateLastPrice(asNumberOrUndefined((data as BackpackTickerMessage['data']).c))
      return
    }

    const mark = data as BackpackMarkPriceMessage['data']
    ticker.updateMarkPrice(asNumberOrUndefined(mark.p))
    ticker.updateIndexPrice(asNumberOrUndefined(mark.i))
    ticker.updateFundingRate(asNumberOrUndefined(mark.f))
    ticker.updateFundingTimestamp(new Date(mark.n))
    ticker.updateTimestamp(fromMicroSecondsToDate(mark.E))

    if (ticker.hasChanged()) {
      yield ticker.getSnapshot(localTimestamp)
    }
  }
}

class BackpackLiquidationsMapper implements Mapper<'backpack', Liquidation> {
  canHandle(message: BackpackMessage<unknown>) {
    return message.stream?.startsWith('liquidation.') === true
  }

  getFilters(symbols: string[] = []) {
    return [{ channel: 'liquidation', symbols } as const]
  }

  *map({ data }: BackpackLiquidationMessage, localTimestamp: Date) {
    yield {
      type: 'liquidation',
      exchange: 'backpack',
      symbol: data.s.toUpperCase(),
      id: undefined,
      price: Number(data.p),
      amount: Number(data.q),
      side: data.S === 'Bid' ? 'buy' : 'sell',
      timestamp: fromMicroSecondsToDate(data.E),
      localTimestamp
    } as const
  }
}

type BackpackBookState = {
  sequence?: number
  discardedThrough?: number
  buffered: CircularBuffer<BackpackDepthMessage['data']>
}

type BackpackMessage<T> = {
  stream: string
  data: T
}

type BackpackTradeMessage = BackpackMessage<{
  s: string
  t: number
  p: string
  q: string
  m: boolean
  T: number
}>

type BackpackDepthMessage = BackpackMessage<{
  s: string
  U: number
  u: number
  a: BackpackLevels
  b: BackpackLevels
  E: number
}>

export type BackpackSnapshotMessage = BackpackMessage<{
  lastUpdateId: string
  timestamp: number
  asks: BackpackLevels
  bids: BackpackLevels
}>

type BackpackLevels = [string, string][]

type BackpackBookTickerMessage = BackpackMessage<{
  s: string
  a: string | null
  A: string | null
  b: string | null
  B: string | null
  E: number
}>

type BackpackTickerMessage = BackpackMessage<{
  s: string
  E: number
  c: string
}>

type BackpackMarkPriceMessage = BackpackMessage<{
  s: string
  E: number
  p: string
  f: string
  i: string
  n: number
}>

type BackpackOpenInterestMessage = BackpackMessage<{
  s: string
  o: string
}>

type BackpackLiquidationMessage = BackpackMessage<{
  s: string
  S: 'Bid' | 'Ask'
  p: string
  q: string
  E: number
}>
