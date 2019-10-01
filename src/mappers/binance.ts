import { Mapper, DataType, Trade, Quote, L2Change, Ticker } from './mapper'
import { FilterForExchange, Filter } from '../consts'

// https://github.com/binance-exchange/binance-official-api-docs/blob/master/web-socket-streams.md

export class BinanceMapper extends Mapper {
  private _symbolToDepthInfoMapping: { [key: string]: LocalDepthInfo } = {}

  private readonly _dataTypeChannelsMapping: { [key in DataType]: FilterForExchange['binance']['channel'][] } = {
    l2change: ['depth', 'depthSnapshot'],
    trade: ['trade'],
    quote: ['bookTicker'],
    ticker: ['ticker']
  }

  public reset() {
    this._symbolToDepthInfoMapping = {}
  }

  public getFiltersForDataTypeAndSymbols(dataType: DataType, symbols?: string[]): Filter<string>[] {
    const matchingChannels = this._dataTypeChannelsMapping[dataType]
    if (symbols) {
      symbols = symbols.map(s => s.toLocaleLowerCase())
    }
    return matchingChannels.map(channel => {
      return {
        channel,
        symbols
      }
    })
  }

  public detectDataType(message: BinanceResponse<any>): DataType | undefined {
    if (message.stream.endsWith('@ticker')) {
      return 'ticker'
    }
    if (message.stream.endsWith('@trade')) {
      return 'trade'
    }
    if (message.stream.endsWith('@bookTicker')) {
      return 'quote'
    }
    if (message.stream.includes('@depth')) {
      return 'l2change'
    }
    return
  }

  protected *mapTrades(binanceTradeResponse: BinanceResponse<BinanceTradeData>, localTimestamp: Date): IterableIterator<Trade> {
    const binanceTrade = binanceTradeResponse.data
    yield {
      type: 'trade',
      id: String(binanceTrade.t),
      symbol: binanceTrade.s,
      price: Number(binanceTrade.p),
      amount: Number(binanceTrade.q),
      side: binanceTrade.m ? 'sell' : 'buy',
      timestamp: new Date(binanceTrade.T),
      localTimestamp
    }
  }

  protected *mapQuotes(binanceBookTickerResponse: BinanceResponse<BinanceBookTickerData>, localTimestamp: Date): IterableIterator<Quote> {
    const binanceQuote = binanceBookTickerResponse.data
    yield {
      type: 'quote',
      symbol: binanceQuote.s,
      bestBidPrice: Number(binanceQuote.b),
      bestBidAmount: Number(binanceQuote.B),
      bestAskPrice: Number(binanceQuote.a),
      bestAskAmount: Number(binanceQuote.A),
      timestamp: localTimestamp,
      localTimestamp
    }
  }

  protected *mapL2OrderBookChanges(
    message: BinanceResponse<BinanceDepthData | BinanceDepthSnapshotData>,
    localTimestamp: Date
  ): IterableIterator<L2Change> {
    const symbol = message.stream.split('@')[0].toUpperCase()
    if (!this._symbolToDepthInfoMapping[symbol]) {
      this._symbolToDepthInfoMapping[symbol] = {
        bufferedUpdates: []
      }
    }
    const symbolDepthInfo = this._symbolToDepthInfoMapping[symbol]
    const snapshotAlreadyProcessed = symbolDepthInfo.snapshotProcessed

    // first check if received message is snapshot and process it as such if it is
    if (message.data.lastUpdateId) {
      // TODO: what to do
      if (snapshotAlreadyProcessed) {
        throw new Error(`Received snapshot when already processed one, ${localTimestamp.toISOString()}`)
      }

      const binanceDepthSnapshotData = message.data
      // produce snapshot l2Change
      yield {
        type: 'l2change',
        changeType: 'snapshot',
        symbol,
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
        const l2Change = this._mapBookDepthUpdate(update, localTimestamp)
        if (l2Change) {
          yield l2Change
        }
      }
      // remove all buffered updates
      symbolDepthInfo.bufferedUpdates = []
    } else if (snapshotAlreadyProcessed) {
      // snapshot was already processed let's map the message as normal l2change
      const l2Change = this._mapBookDepthUpdate(message.data as BinanceDepthData, localTimestamp)
      if (l2Change) {
        yield l2Change
      }
    } else {
      // if snapshot hasn't been yet processed and we've got depthUpdate message, let's buffer it for later processing
      const binanceDepthUpdateData = message.data as BinanceDepthData
      symbolDepthInfo.bufferedUpdates.push(binanceDepthUpdateData)
    }
  }

  protected *mapTickers(binanceTickerResponse: BinanceResponse<BinanceTickerData>, localTimestamp: Date): IterableIterator<Ticker> {
    const binanceTicker = binanceTickerResponse.data
    yield {
      type: 'ticker',
      symbol: binanceTicker.s,
      bestBidPrice: Number(binanceTicker.b),
      bestAskPrice: Number(binanceTicker.a),
      lastPrice: Number(binanceTicker.c),
      timestamp: new Date(binanceTicker.E),
      localTimestamp
    }
  }

  private _mapBookDepthUpdate(binanceDepthUpdateData: BinanceDepthData, localTimestamp: Date): L2Change | undefined {
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
        throw new Error(`Book depth snaphot has no overlap with first update, update ${JSON.stringify(binanceDepthUpdateData)}`)
      }
    }

    return {
      type: 'l2change',
      changeType: 'update',
      symbol: binanceDepthUpdateData.s,
      bids: binanceDepthUpdateData.b.map(this._mapBookLevel),
      asks: binanceDepthUpdateData.a.map(this._mapBookLevel),
      timestamp: new Date(binanceDepthUpdateData.E),
      localTimestamp
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
  private readonly _channelsMapping: { [key in DataType]?: FilterForExchange['binance-futures']['channel'][] } = {
    l2change: ['depth', 'depthSnapshot'],
    trade: ['aggTrade'],
    ticker: ['ticker', 'markPrice'] // use mark price channel to suplement ticker that does not have that info
  }

  private readonly _symbolToMarkPriceMap: Map<
    string,
    {
      fundingRate: number
      markPrice: number
    }
  > = new Map()

  public reset() {
    super.reset()
    this._symbolToMarkPriceMap.clear()
  }

  public getFiltersForDataTypeAndSymbols(dataType: DataType, symbols?: string[]) {
    if (!this.getSupportedDataTypes().includes(dataType)) {
      throw new Error(`BinanceFutures mapper does not support normalized ${dataType} data`)
    }

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

  public detectDataType(message: BinanceResponse<any>): DataType | undefined {
    if (message.stream.endsWith('@markPrice')) {
      // store last mark price info for symbol given symbol
      const binanceMarkPrice = message.data as BinanceFuturesMarkPriceData
      this._symbolToMarkPriceMap.set(binanceMarkPrice.s, {
        fundingRate: Number(binanceMarkPrice.r),
        markPrice: Number(binanceMarkPrice.p)
      })
    }

    if (message.stream.endsWith('@ticker')) {
      return 'ticker'
    }

    if (message.stream.endsWith('@aggTrade')) {
      return 'trade'
    }

    if (message.stream.includes('@depth')) {
      return 'l2change'
    }
    return
  }

  public getSupportedDataTypes(): DataType[] {
    return ['trade', 'ticker', 'l2change']
  }

  // binance futures currently does not support bookTicker
  protected mapQuotes(): IterableIterator<Quote> {
    throw new Error('normalized quotes not supported.')
  }

  // binance futures currently doesn't provide individual trades only aggTrade
  protected *mapTrades(binanceFuturesAggTrade: any, localTimestamp: Date): IterableIterator<Trade> {
    const binanceTrade = binanceFuturesAggTrade.data as BinanceFuturesAggTradeData
    yield {
      type: 'trade',
      id: String(binanceTrade.l),
      symbol: binanceTrade.s,
      price: Number(binanceTrade.p),
      amount: Number(binanceTrade.q),
      side: binanceTrade.m ? 'sell' : 'buy',
      timestamp: new Date(binanceTrade.T),
      localTimestamp
    }
  }

  protected *mapTickers(binanceTickerResponse: BinanceResponse<any>, localTimestamp: Date): IterableIterator<Ticker> {
    const binanceFuturesTicker = binanceTickerResponse.data as BinanceFuturesTickerData
    const markPriceInfo = this._symbolToMarkPriceMap.get(binanceFuturesTicker.s)
    //  suplement ticker with last mark price info if exists
    yield {
      type: 'ticker',
      symbol: binanceFuturesTicker.s,
      lastPrice: Number(binanceFuturesTicker.c),
      timestamp: new Date(binanceFuturesTicker.E),
      fundingRate: markPriceInfo && markPriceInfo.fundingRate,
      markPrice: markPriceInfo && markPriceInfo.markPrice,
      localTimestamp
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
type BinanceBookTickerData = {
  s: string
  b: string
  B: string
  a: string
  A: string
}
type BinanceTickerData = {
  E: number
  s: string
  c: string
  b: string
  a: string
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
  p: string // Mark price
  r: string // Funding rate
}

type BinanceFuturesTickerData = {
  E: number // Event time
  s: string // Symbol
  c: string // Last price
}
