import { BookChange, DerivativeTicker, Exchange, FilterForExchange, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://github.com/binance-exchange/binance-official-api-docs/blob/master/web-socket-streams.md

export class BinanceTradesMapper implements Mapper<'binance' | 'binance-jersey' | 'binance-us', Trade> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: BinanceResponse<any>) {
    return message.stream.endsWith('@trade')
  }

  getFilters(symbols?: string[]) {
    symbols = lowerCaseSymbols(symbols)

    return [
      {
        channel: 'trade',
        symbols
      } as const
    ]
  }

  *map(binanceTradeResponse: BinanceResponse<BinanceTradeData>, localTimestamp: Date) {
    const binanceTrade = binanceTradeResponse.data

    const trade: Trade = {
      type: 'trade',
      symbol: binanceTrade.s,
      exchange: this._exchange,
      id: String(binanceTrade.t),
      price: Number(binanceTrade.p),
      amount: Number(binanceTrade.q),
      side: binanceTrade.m ? 'sell' : 'buy',
      timestamp: new Date(binanceTrade.T),
      localTimestamp: localTimestamp
    }

    yield trade
  }
}

export class BinanceBookChangeMapper implements Mapper<'binance' | 'binance-jersey' | 'binance-us' | 'binance-futures', BookChange> {
  protected readonly symbolToDepthInfoMapping: { [key: string]: LocalDepthInfo } = {}

  constructor(protected readonly exchange: Exchange) {}

  canHandle(message: BinanceResponse<any>) {
    return message.stream.includes('@depth')
  }

  getFilters(symbols?: string[]) {
    symbols = lowerCaseSymbols(symbols)

    return [
      {
        channel: 'depth',
        symbols
      } as const,
      {
        channel: 'depthSnapshot',
        symbols
      } as const
    ]
  }

  *map(message: BinanceResponse<BinanceDepthData | BinanceDepthSnapshotData>, localTimestamp: Date) {
    const symbol = message.stream.split('@')[0].toUpperCase()

    if (this.symbolToDepthInfoMapping[symbol] === undefined) {
      this.symbolToDepthInfoMapping[symbol] = {
        bufferedUpdates: []
      }
    }

    const symbolDepthInfo = this.symbolToDepthInfoMapping[symbol]
    const snapshotAlreadyProcessed = symbolDepthInfo.snapshotProcessed

    // first check if received message is snapshot and process it as such if it is
    if (message.data.lastUpdateId !== undefined) {
      if (snapshotAlreadyProcessed) {
        throw new Error(`Received snapshot when already processed one, ${localTimestamp.toISOString()}`)
      }

      const binanceDepthSnapshotData = message.data
      // produce snapshot book_change
      const bookChange: BookChange = {
        type: 'book_change',
        symbol,
        exchange: this.exchange,
        isSnapshot: true,
        bids: binanceDepthSnapshotData.bids.map(this.mapBookLevel),
        asks: binanceDepthSnapshotData.asks.map(this.mapBookLevel),
        timestamp: localTimestamp,
        localTimestamp
      }

      yield bookChange

      //  mark given symbol depth info that has snapshot processed
      symbolDepthInfo.lastUpdateId = binanceDepthSnapshotData.lastUpdateId
      symbolDepthInfo.snapshotProcessed = true

      // if there were any depth updates buffered, let's proccess those
      for (const update of symbolDepthInfo.bufferedUpdates) {
        const bookChange = this.mapBookDepthUpdate(update, localTimestamp)
        if (bookChange !== undefined) {
          yield bookChange
        }
      }
      // remove all buffered updates
      symbolDepthInfo.bufferedUpdates = []
    } else if (snapshotAlreadyProcessed) {
      // snapshot was already processed let's map the message as normal book_change
      const bookChange = this.mapBookDepthUpdate(message.data as BinanceDepthData, localTimestamp)
      if (bookChange !== undefined) {
        yield bookChange
      }
    } else {
      // if snapshot hasn't been yet processed and we've got depthUpdate message, let's buffer it for later processing
      const binanceDepthUpdateData = message.data as BinanceDepthData
      symbolDepthInfo.bufferedUpdates.push(binanceDepthUpdateData)
    }
  }

  protected mapBookDepthUpdate(binanceDepthUpdateData: BinanceDepthData, localTimestamp: Date): BookChange | undefined {
    // we can safely assume here that depthContext and lastUpdateId aren't null here as this is method only works
    // when we've already processed the snapshot
    const depthContext = this.symbolToDepthInfoMapping[binanceDepthUpdateData.s]!
    const lastUpdateId = depthContext.lastUpdateId!

    // Drop any event where u is <= lastUpdateId in the snapshot
    if (binanceDepthUpdateData.u <= lastUpdateId) {
      return
    }

    // The first processed event should have U <= lastUpdateId+1 AND u >= lastUpdateId+1.
    if (!depthContext.validatedFirstUpdate) {
      if (binanceDepthUpdateData.U <= lastUpdateId + 1 && binanceDepthUpdateData.u >= lastUpdateId + 1) {
        depthContext.validatedFirstUpdate = true
      } else {
        throw new Error(
          `Book depth snaphot has no overlap with first update, update ${JSON.stringify(
            binanceDepthUpdateData
          )}, lastUpdateId: ${lastUpdateId}, exchange ${this.exchange}`
        )
      }
    }

    return {
      type: 'book_change',
      symbol: binanceDepthUpdateData.s,
      exchange: this.exchange,
      isSnapshot: false,

      bids: binanceDepthUpdateData.b.map(this.mapBookLevel),
      asks: binanceDepthUpdateData.a.map(this.mapBookLevel),
      timestamp: new Date(binanceDepthUpdateData.E),
      localTimestamp: localTimestamp
    }
  }

  protected mapBookLevel(level: BinanceBookLevel) {
    const price = Number(level[0])
    const amount = Number(level[1])
    return { price, amount }
  }
}

export const binanceFuturesTradesMapper: Mapper<'binance-futures', Trade> = {
  canHandle(message: BinanceResponse<any>) {
    return message.stream.endsWith('@aggTrade')
  },

  getFilters(symbols?: string[]) {
    symbols = lowerCaseSymbols(symbols)

    return [
      {
        channel: 'aggTrade',
        symbols
      } as const
    ]
  },

  *map(binanceFuturesAggTrade: BinanceResponse<BinanceFuturesAggTradeData>, localTimestamp: Date) {
    const binanceTrade = binanceFuturesAggTrade.data

    yield {
      type: 'trade',
      symbol: binanceTrade.s,
      exchange: 'binance-futures',
      id: String(binanceTrade.l),
      price: Number(binanceTrade.p),
      amount: Number(binanceTrade.q),
      side: binanceTrade.m ? 'sell' : 'buy',
      timestamp: new Date(binanceTrade.T),
      localTimestamp: localTimestamp
    }
  }
}

export class BinanceFuturesBookChangeMapper extends BinanceBookChangeMapper implements Mapper<'binance-futures', BookChange> {
  constructor() {
    super('binance-futures')
  }

  protected mapBookDepthUpdate(binanceDepthUpdateData: BinanceDepthData, localTimestamp: Date): BookChange | undefined {
    // we can safely assume here that depthContext and lastUpdateId aren't null here as this is method only works
    // when we've already processed the snapshot
    const depthContext = this.symbolToDepthInfoMapping[binanceDepthUpdateData.s]!
    const lastUpdateId = depthContext.lastUpdateId!
    // based on https://binanceapitest.github.io/Binance-Futures-API-doc/wss/#how-to-manage-a-local-order-book-correctly
    // Drop any event where u is < lastUpdateId in the snapshot
    if (binanceDepthUpdateData.u < lastUpdateId) {
      return
    }

    // The first processed should have U <= lastUpdateId AND u >= lastUpdateId
    if (!depthContext.validatedFirstUpdate) {
      if (binanceDepthUpdateData.U <= lastUpdateId && binanceDepthUpdateData.u >= lastUpdateId) {
        depthContext.validatedFirstUpdate = true
      } else {
        throw new Error(
          `Book depth snaphot has no overlap with first update, update ${JSON.stringify(
            binanceDepthUpdateData
          )}, lastUpdateId: ${lastUpdateId}, exchange ${this.exchange}`
        )
      }
    }

    return {
      type: 'book_change',
      symbol: binanceDepthUpdateData.s,
      exchange: this.exchange,
      isSnapshot: false,

      bids: binanceDepthUpdateData.b.map(this.mapBookLevel),
      asks: binanceDepthUpdateData.a.map(this.mapBookLevel),
      timestamp: new Date(binanceDepthUpdateData.E),
      localTimestamp: localTimestamp
    }
  }
}

export class BinanceFuturesDerivativeTickerMapper implements Mapper<'binance-futures', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: BinanceResponse<any>) {
    return message.stream.endsWith('@markPrice') || message.stream.endsWith('@ticker')
  }

  getFilters(symbols?: string[]): FilterForExchange['binance-futures'][] {
    symbols = lowerCaseSymbols(symbols)

    return [
      {
        channel: 'markPrice',
        symbols
      },
      {
        channel: 'ticker',
        symbols
      }
    ]
  }

  *map(
    message: BinanceResponse<BinanceFuturesMarkPriceData | BinanceFuturesTickerData>,
    localTimestamp: Date
  ): IterableIterator<DerivativeTicker> {
    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.data.s, 'binance-futures')

    if ('r' in message.data) {
      pendingTickerInfo.updateFundingRate(Number(message.data.r))
      pendingTickerInfo.updateMarkPrice(Number(message.data.p))
    }
    if ('c' in message.data) {
      pendingTickerInfo.updateLastPrice(Number(message.data.c))
    }

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(new Date(message.data.E), localTimestamp)
    }
  }
}

function lowerCaseSymbols(symbols?: string[]) {
  if (symbols !== undefined) {
    return symbols.map(s => s.toLocaleLowerCase())
  }
  return
}

type BinanceResponse<T> = {
  stream: string
  data: T
}

type BinanceTradeData = {
  s: string
  t: number
  p: string
  q: string
  T: number
  m: true
}

type BinanceBookLevel = [string, string]

type BinanceDepthData = {
  lastUpdateId: undefined
  E: number
  s: string
  U: number
  u: number
  b: BinanceBookLevel[]
  a: BinanceBookLevel[]
}

type BinanceDepthSnapshotData = {
  lastUpdateId: number
  bids: BinanceBookLevel[]
  asks: BinanceBookLevel[]
}

type LocalDepthInfo = {
  bufferedUpdates: BinanceDepthData[]
  snapshotProcessed?: boolean
  lastUpdateId?: number
  validatedFirstUpdate?: boolean
}

type BinanceFuturesAggTradeData = {
  s: string // Symbol
  p: string // Price
  q: string // Quantity
  f: number // First trade ID
  l: number // Last trade ID
  T: number // Trade time
  m: boolean // Is the buyer the market maker?
}

type BinanceFuturesMarkPriceData = {
  s: string // Symbol
  E: number // Event time
  p: string // Mark price
  r: string // Funding rate
}

type BinanceFuturesTickerData = {
  E: number // Event time
  s: string // Symbol
  c: string // Last price
}
