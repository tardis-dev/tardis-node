import { CircularBuffer, lowerCaseSymbols } from '../handy.ts'
import { BookChange, BookTicker, Trade } from '../types.ts'
import { Mapper } from './mapper.ts'
import { exchangeMappers, isRealTime } from './registry.ts'

export const asterMappers = exchangeMappers({
  aster: {
    trades: () => new AsterTradesMapper(),
    bookChanges: (localTimestamp) =>
      new AsterBookChangeMapper({
        ignoreBookSnapshotOverlapError: shouldIgnoreBookSnapshotOverlap(localTimestamp)
      }),
    bookTickers: () => new AsterBookTickerMapper()
  }
})

function shouldIgnoreBookSnapshotOverlap(date?: Date) {
  if (process.env.IGNORE_BOOK_SNAPSHOT_OVERLAP_ERROR) {
    return true
  }

  return isRealTime(date) === false
}

class AsterTradesMapper implements Mapper<'aster', Trade> {
  canHandle(message: AsterMessage<any>) {
    return message.stream?.endsWith('@trade') === true
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'trade', symbols: lowerCaseSymbols(symbols) } as const]
  }

  *map({ data }: AsterMessage<AsterTradeData>, localTimestamp: Date) {
    const trade: Trade = {
      type: 'trade',
      symbol: data.s,
      exchange: 'aster',
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

class AsterBookChangeMapper implements Mapper<'aster', BookChange> {
  private readonly symbolToDepthInfoMapping: { [key: string]: LocalDepthInfo } = {}
  private readonly ignoreBookSnapshotOverlapError: boolean

  constructor({ ignoreBookSnapshotOverlapError }: { ignoreBookSnapshotOverlapError: boolean }) {
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
        exchange: 'aster',
        isSnapshot: true,
        bids: data.bids.map(this.mapBookLevel),
        asks: data.asks.map(this.mapBookLevel),
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

  private mapBookDepthUpdate(depthUpdateData: AsterDepthData, localTimestamp: Date): BookChange | undefined {
    const depthContext = this.symbolToDepthInfoMapping[depthUpdateData.s]!

    if (depthUpdateData.u <= depthContext.lastUpdateId!) {
      return
    }

    if (!depthContext.validatedFirstUpdate) {
      if (
        (depthUpdateData.U <= depthContext.lastUpdateId! + 1 && depthUpdateData.u >= depthContext.lastUpdateId! + 1) ||
        depthContext.lastUpdateId! == -1
      ) {
        depthContext.validatedFirstUpdate = true
      } else if (this.ignoreBookSnapshotOverlapError) {
        depthContext.validatedFirstUpdate = true
      } else {
        throw new Error(
          `Book depth snaphot has no overlap with first update, update ${JSON.stringify(
            depthUpdateData
          )}, lastUpdateId: ${depthContext.lastUpdateId!}, exchange aster`
        )
      }
    }

    return {
      type: 'book_change',
      symbol: depthUpdateData.s,
      exchange: 'aster',
      isSnapshot: false,
      bids: depthUpdateData.b.map(this.mapBookLevel),
      asks: depthUpdateData.a.map(this.mapBookLevel),
      timestamp: new Date(depthUpdateData.E),
      localTimestamp
    }
  }
  private mapBookLevel(level: AsterBookLevel) {
    return {
      price: Number(level[0]),
      amount: Number(level[1])
    }
  }
}

class AsterBookTickerMapper implements Mapper<'aster', BookTicker> {
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
      exchange: 'aster',
      askAmount: data.A !== undefined ? Number(data.A) : undefined,
      askPrice: data.a !== undefined ? Number(data.a) : undefined,
      bidPrice: data.b !== undefined ? Number(data.b) : undefined,
      bidAmount: data.B !== undefined ? Number(data.B) : undefined,
      timestamp: data.E !== undefined ? new Date(data.E) : localTimestamp,
      localTimestamp
    }

    yield ticker
  }
}

type AsterMessage<T> = {
  stream: string
  data: T
}

type AsterTradeData = {
  s: string
  t: number
  p: string
  q: string
  T: number
  m: boolean
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
