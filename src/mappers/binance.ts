import { DataType, Trade, BookChange, DerivativeTicker, FilterForExchange, Filter } from '../types'
import { MapperBase } from './mapper'

// https://github.com/binance-exchange/binance-official-api-docs/blob/master/web-socket-streams.md

export class BinanceMapper extends MapperBase {
  public supportedDataTypes: DataType[] = ['trade', 'book_change']

  private readonly _symbolToDepthInfoMapping: { [key: string]: LocalDepthInfo } = {}

  private readonly _dataTypeChannelsMapping: { [key in DataType]?: FilterForExchange['binance']['channel'][] } = {
    book_change: ['depth', 'depthSnapshot'],
    trade: ['trade']
  }

  protected mapDataTypeAndSymbolsToFilters(dataType: DataType, symbols?: string[]): Filter<string>[] {
    const matchingChannels = this._dataTypeChannelsMapping[dataType]!
    if (symbols !== undefined) {
      symbols = symbols.map(s => s.toLocaleLowerCase())
    }
    return matchingChannels.map(channel => {
      return {
        channel,
        symbols
      }
    })
  }

  protected detectDataType(message: BinanceResponse<any>): DataType | undefined {
    if (message.stream.endsWith('@trade')) {
      return 'trade'
    }

    if (message.stream.includes('@depth')) {
      return 'book_change'
    }

    return
  }

  protected *mapTrades(binanceTradeResponse: BinanceResponse<BinanceTradeData>, localTimestamp: Date): IterableIterator<Trade> {
    const binanceTrade = binanceTradeResponse.data
    yield {
      type: 'trade',
      symbol: binanceTrade.s,
      exchange: this.exchange,
      id: String(binanceTrade.t),
      price: Number(binanceTrade.p),
      amount: Number(binanceTrade.q),
      side: binanceTrade.m ? 'sell' : 'buy',
      timestamp: new Date(binanceTrade.T),
      localTimestamp: localTimestamp
    }
  }

  protected *mapOrderBookChanges(
    message: BinanceResponse<BinanceDepthData | BinanceDepthSnapshotData>,
    localTimestamp: Date
  ): IterableIterator<BookChange> {
    const symbol = message.stream.split('@')[0].toUpperCase()

    if (this._symbolToDepthInfoMapping[symbol] === undefined) {
      this._symbolToDepthInfoMapping[symbol] = {
        bufferedUpdates: []
      }
    }

    const symbolDepthInfo = this._symbolToDepthInfoMapping[symbol]
    const snapshotAlreadyProcessed = symbolDepthInfo.snapshotProcessed

    // first check if received message is snapshot and process it as such if it is
    if (message.data.lastUpdateId !== undefined) {
      if (snapshotAlreadyProcessed) {
        throw new Error(`Received snapshot when already processed one, ${localTimestamp.toISOString()}`)
      }

      const binanceDepthSnapshotData = message.data
      // produce snapshot book_change
      yield {
        type: 'book_change',
        symbol,
        exchange: this.exchange,
        isSnapshot: true,
        bids: binanceDepthSnapshotData.bids.map(this._mapBookLevel),
        asks: binanceDepthSnapshotData.asks.map(this._mapBookLevel),
        timestamp: localTimestamp,
        localTimestamp
      }

      //  mark given symbol depth info that has snapshot processed
      symbolDepthInfo.lastUpdateId = binanceDepthSnapshotData.lastUpdateId
      symbolDepthInfo.snapshotProcessed = true

      // if there were any depth updates buffered, let's proccess those
      for (const update of symbolDepthInfo.bufferedUpdates) {
        const bookChange = this._mapBookDepthUpdate(update, localTimestamp)
        if (bookChange !== undefined) {
          yield bookChange
        }
      }
      // remove all buffered updates
      symbolDepthInfo.bufferedUpdates = []
    } else if (snapshotAlreadyProcessed) {
      // snapshot was already processed let's map the message as normal book_change
      const bookChange = this._mapBookDepthUpdate(message.data as BinanceDepthData, localTimestamp)
      if (bookChange !== undefined) {
        yield bookChange
      }
    } else {
      // if snapshot hasn't been yet processed and we've got depthUpdate message, let's buffer it for later processing
      const binanceDepthUpdateData = message.data as BinanceDepthData
      symbolDepthInfo.bufferedUpdates.push(binanceDepthUpdateData)
    }
  }

  private _mapBookDepthUpdate(binanceDepthUpdateData: BinanceDepthData, localTimestamp: Date): BookChange | undefined {
    // we can safely assume here that depthContext and lastUpdateId aren't null here as this is method only works
    // when we've already processed the snapshot
    const depthContext = this._symbolToDepthInfoMapping[binanceDepthUpdateData.s]!
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
          `Book depth snaphot has no overlap with first update, update ${JSON.stringify(binanceDepthUpdateData)}, exchange ${this.exchange}`
        )
      }
    }

    return {
      type: 'book_change',
      symbol: binanceDepthUpdateData.s,
      exchange: this.exchange,
      isSnapshot: false,

      bids: binanceDepthUpdateData.b.map(this._mapBookLevel),
      asks: binanceDepthUpdateData.a.map(this._mapBookLevel),
      timestamp: new Date(binanceDepthUpdateData.E),
      localTimestamp: localTimestamp
    }
  }

  private _mapBookLevel(level: BinanceBookLevel) {
    const price = Number(level[0])
    const amount = Number(level[1])
    return { price, amount }
  }
}

// https://binanceapitest.github.io/Binance-Futures-API-doc/wss/
export class BinanceFuturesMapper extends BinanceMapper {
  public supportedDataTypes: DataType[] = ['trade', 'book_change', 'derivative_ticker']

  private readonly _channelsMapping: { [key in DataType]?: FilterForExchange['binance-futures']['channel'][] } = {
    book_change: ['depth', 'depthSnapshot'],
    trade: ['aggTrade'],
    derivative_ticker: ['markPrice', 'ticker']
  }

  protected mapDataTypeAndSymbolsToFilters(dataType: DataType, symbols?: string[]) {
    const matchingChannels = this._channelsMapping[dataType]
    if (symbols) {
      symbols = symbols.map(s => s.toLocaleLowerCase())
    }

    return matchingChannels!.map(channel => {
      return {
        channel,
        symbols
      }
    })
  }

  protected detectDataType(message: BinanceResponse<any>): DataType | undefined {
    if (message.stream.endsWith('@markPrice')) {
      return 'derivative_ticker'
    }

    if (message.stream.endsWith('@ticker')) {
      return 'derivative_ticker'
    }

    if (message.stream.endsWith('@aggTrade')) {
      return 'trade'
    }

    if (message.stream.includes('@depth')) {
      return 'book_change'
    }

    return
  }

  // binance futures currently doesn't provide individual trades only aggTrade
  protected *mapTrades(binanceFuturesAggTrade: any, localTimestamp: Date): IterableIterator<Trade> {
    const binanceTrade = binanceFuturesAggTrade.data as BinanceFuturesAggTradeData
    yield {
      type: 'trade',
      symbol: binanceTrade.s,
      exchange: this.exchange,
      id: String(binanceTrade.l),
      price: Number(binanceTrade.p),
      amount: Number(binanceTrade.q),
      side: binanceTrade.m ? 'sell' : 'buy',
      timestamp: new Date(binanceTrade.T),
      localTimestamp: localTimestamp
    }
  }

  protected *mapDerivativeTickerInfo(
    message: BinanceResponse<BinanceFuturesMarkPriceData | BinanceFuturesTickerData>,
    localTimestamp: Date
  ): IterableIterator<DerivativeTicker> {
    const pendingTickerInfo = this.getPendingTickerInfo(message.data.s)

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
