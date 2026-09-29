import { asNonZeroNumberOrUndefined, CircularBuffer, fromMicroSecondsToDate, upperCaseSymbols } from '../handy.ts'
import { BookChange, BookTicker, Trade } from '../types.ts'
import { Mapper } from './mapper.ts'
import { exchangeMappers, isRealTime } from './registry.ts'

export const bitvavoMappers = exchangeMappers({
  bitvavo: {
    trades: () => new BitvavoTradesMapper(),
    bookChanges: (localTimestamp) => new BitvavoBookChangeMapper({ validateSequence: isRealTime(localTimestamp) }),
    bookTickers: () => new BitvavoBookTickerMapper()
  }
})

class BitvavoTradesMapper implements Mapper<'bitvavo', Trade> {
  canHandle(message: BitvavoMessage) {
    return message.event === 'trade'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'trade', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: BitvavoTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: message.market,
      exchange: 'bitvavo',
      id: message.id,
      price: Number(message.price),
      amount: Number(message.amount),
      side: message.side,
      timestamp: message.timestampNs === undefined ? new Date(message.timestamp) : fromNanoseconds(message.timestampNs),
      localTimestamp
    }
  }
}

class BitvavoBookChangeMapper implements Mapper<'bitvavo', BookChange> {
  private readonly depthInfoBySymbol = new Map<string, BitvavoDepthInfo>()

  constructor(private readonly options: { validateSequence: boolean }) {}

  canHandle(message: BitvavoMessage) {
    return message.event === 'book' || message.action === 'getBook'
  }

  getFilters(symbols?: string[]) {
    const normalizedSymbols = upperCaseSymbols(symbols)
    return [{ channel: 'book', symbols: normalizedSymbols } as const, { channel: 'getBook', symbols: normalizedSymbols } as const]
  }

  *map(message: BitvavoBookMessage | BitvavoBookSnapshotMessage, localTimestamp: Date): IterableIterator<BookChange> {
    if ('action' in message) {
      const snapshot = message.response
      const depthInfo = this.getDepthInfo(snapshot.market)
      if (depthInfo.snapshotProcessed) {
        return
      }

      const snapshotSequence = snapshot.mdSeqNo ?? snapshot.nonce
      depthInfo.sequence = snapshotSequence
      depthInfo.snapshotProcessed = true

      yield {
        type: 'book_change',
        symbol: snapshot.market,
        exchange: 'bitvavo',
        isSnapshot: true,
        bids: snapshot.bids.map(mapBookLevel),
        asks: snapshot.asks.map(mapBookLevel),
        timestamp: fromNanoseconds(snapshot.timestamp),
        localTimestamp
      }

      for (const update of depthInfo.bufferedUpdates.items()) {
        const mapped = this.mapUpdate(update, localTimestamp, depthInfo)
        if (mapped !== undefined) {
          yield mapped
        }
      }
      depthInfo.bufferedUpdates.clear()
      return
    }

    const depthInfo = this.getDepthInfo(message.market)
    if (!depthInfo.snapshotProcessed) {
      depthInfo.bufferedUpdates.append(message)
      return
    }

    const mapped = this.mapUpdate(message, localTimestamp, depthInfo)
    if (mapped !== undefined) {
      yield mapped
    }
  }

  private mapUpdate(message: BitvavoBookMessage, localTimestamp: Date, depthInfo: BitvavoDepthInfo): BookChange | undefined {
    const firstSequence = message.startMdSeqNo ?? message.nonce
    const lastSequence = message.endMdSeqNo ?? message.nonce
    if (lastSequence <= depthInfo.sequence!) {
      return
    }
    // Recorder validates historical continuity; direct live feeds must detect gaps themselves.
    if (this.options.validateSequence && firstSequence > depthInfo.sequence! + 1) {
      throw new Error(
        `Bitvavo book update sequence gap for ${message.market}: expected ${depthInfo.sequence! + 1}, received ${firstSequence}-${lastSequence}`
      )
    }

    depthInfo.sequence = lastSequence
    return {
      type: 'book_change',
      symbol: message.market,
      exchange: 'bitvavo',
      isSnapshot: false,
      bids: message.bids.map(mapBookLevel),
      asks: message.asks.map(mapBookLevel),
      timestamp: fromNanoseconds(message.timestamp),
      localTimestamp
    }
  }

  private getDepthInfo(symbol: string) {
    let depthInfo = this.depthInfoBySymbol.get(symbol)
    if (depthInfo === undefined) {
      depthInfo = { bufferedUpdates: new CircularBuffer<BitvavoBookMessage>(2000) }
      this.depthInfoBySymbol.set(symbol, depthInfo)
    }
    return depthInfo
  }
}

class BitvavoBookTickerMapper implements Mapper<'bitvavo', BookTicker> {
  private readonly quotesByMarket = new Map<string, BitvavoQuote>()

  canHandle(message: BitvavoMessage) {
    return message.event === 'ticker'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'ticker', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: BitvavoTickerMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    let quote = this.quotesByMarket.get(message.market)
    if (quote === undefined) {
      quote = { askAmount: undefined, askPrice: undefined, bidAmount: undefined, bidPrice: undefined }
      this.quotesByMarket.set(message.market, quote)
    }

    // Recorded ticker payloads omit unchanged fields, so retain the previous quote per market.
    let hasQuoteUpdate = false
    if (message.bestAskSize !== undefined) {
      quote.askAmount = asNonZeroNumberOrUndefined(message.bestAskSize)
      hasQuoteUpdate = true
    }
    if (message.bestAsk !== undefined) {
      quote.askPrice = asNonZeroNumberOrUndefined(message.bestAsk)
      hasQuoteUpdate = true
    }
    if (message.bestBidSize !== undefined) {
      quote.bidAmount = asNonZeroNumberOrUndefined(message.bestBidSize)
      hasQuoteUpdate = true
    }
    if (message.bestBid !== undefined) {
      quote.bidPrice = asNonZeroNumberOrUndefined(message.bestBid)
      hasQuoteUpdate = true
    }

    if (!hasQuoteUpdate) {
      return
    }

    yield {
      type: 'book_ticker',
      symbol: message.market,
      exchange: 'bitvavo',
      ...quote,
      timestamp: localTimestamp,
      localTimestamp
    }
  }
}

function mapBookLevel([price, amount]: BitvavoBookLevel) {
  return {
    price: Number(price),
    amount: Number(amount)
  }
}

function fromNanoseconds(nanoseconds: string) {
  return fromMicroSecondsToDate(Number(nanoseconds.slice(0, -3)))
}

type BitvavoMessage = { event?: string; action?: string }

type BitvavoTradeMessage = {
  event: 'trade'
  id: string
  amount: string
  price: string
  timestamp: number
  timestampNs?: string
  market: string
  side: 'buy' | 'sell'
}

type BitvavoBookMessage = {
  event: 'book'
  market: string
  nonce: number
  bids: BitvavoBookLevel[]
  asks: BitvavoBookLevel[]
  timestamp: string
  startMdSeqNo?: number
  endMdSeqNo?: number
}

type BitvavoBookSnapshotMessage = {
  action: 'getBook'
  requestId: number
  response: {
    market: string
    nonce: number
    bids: BitvavoBookLevel[]
    asks: BitvavoBookLevel[]
    timestamp: string
    mdSeqNo?: number
  }
}

type BitvavoBookLevel = [string, string]

type BitvavoTickerMessage = {
  event: 'ticker'
  market: string
  bestAsk?: string
  bestAskSize?: string
  bestBid?: string
  bestBidSize?: string
  lastPrice?: string
}

type BitvavoQuote = {
  askAmount: number | undefined
  askPrice: number | undefined
  bidAmount: number | undefined
  bidPrice: number | undefined
}

type BitvavoDepthInfo = {
  bufferedUpdates: CircularBuffer<BitvavoBookMessage>
  snapshotProcessed?: boolean
  sequence?: number
}
