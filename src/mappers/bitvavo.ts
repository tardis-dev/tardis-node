import { asNonZeroNumberOrUndefined, CircularBuffer, upperCaseSymbols } from '../handy.ts'
import { BookChange, BookTicker, Trade } from '../types.ts'
import { Mapper } from './mapper.ts'
import { exchangeMappers } from './registry.ts'

export const bitvavoMappers = exchangeMappers({
  bitvavo: {
    trades: () => new BitvavoTradesMapper(),
    bookChanges: () => new BitvavoBookChangeMapper(),
    bookTickers: () => new BitvavoBookTickerMapper()
  }
})

class BitvavoTradesMapper implements Mapper<'bitvavo', Trade> {
  canHandle(message: BitvavoMessage): message is BitvavoTradeMessage {
    return 'event' in message && message.event === 'trade'
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

  canHandle(message: BitvavoMessage): message is BitvavoBookMessage | BitvavoBookSnapshotMessage {
    return ('event' in message && message.event === 'book') || ('action' in message && message.action === 'getBook')
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
    if (firstSequence > depthInfo.sequence! + 1) {
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
  canHandle(message: BitvavoMessage): message is BitvavoTickerMessage {
    return (
      'event' in message &&
      message.event === 'ticker' &&
      ('bestAsk' in message || 'bestAskSize' in message || 'bestBid' in message || 'bestBidSize' in message)
    )
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'ticker', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: BitvavoTickerMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    yield {
      type: 'book_ticker',
      symbol: message.market,
      exchange: 'bitvavo',
      askAmount: asNonZeroNumberOrUndefined(message.bestAskSize),
      askPrice: asNonZeroNumberOrUndefined(message.bestAsk),
      bidAmount: asNonZeroNumberOrUndefined(message.bestBidSize),
      bidPrice: asNonZeroNumberOrUndefined(message.bestBid),
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

function fromNanoseconds(nanoseconds: number) {
  const microseconds = Math.floor(nanoseconds / 1000)
  const timestamp = new Date(microseconds / 1000)
  timestamp.μs = microseconds % 1000
  return timestamp
}

type BitvavoMessage = BitvavoTradeMessage | BitvavoBookMessage | BitvavoTickerMessage | BitvavoBookSnapshotMessage | BitvavoControlMessage

type BitvavoTradeMessage = {
  event: 'trade'
  id: string
  amount: string
  price: string
  timestamp: number
  timestampNs?: number
  market: string
  side: 'buy' | 'sell'
}

type BitvavoBookMessage = {
  event: 'book'
  market: string
  nonce: number
  bids: BitvavoBookLevel[]
  asks: BitvavoBookLevel[]
  timestamp: number
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
    timestamp: number
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

type BitvavoControlMessage = {
  event: 'authenticate' | 'subscribed' | 'error'
}

type BitvavoDepthInfo = {
  bufferedUpdates: CircularBuffer<BitvavoBookMessage>
  snapshotProcessed?: boolean
  sequence?: number
}
