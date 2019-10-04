import { DataType, BookChange, Trade, FilterForExchange } from '../types'
import { MapperBase } from './mapper'

// https://docs.binance.org/api-reference/dex-api/ws-streams.html

export class BinanceDexMapper extends MapperBase {
  public supportedDataTypes = ['trade', 'book_change'] as const

  private readonly _dataTypeChannelsMapping: { [key in DataType]?: FilterForExchange['binance-dex']['channel'][] } = {
    trade: ['trades'],
    book_change: ['depthSnapshot', 'marketDiff']
  }

  protected mapDataTypeAndSymbolsToFilters(dataType: DataType, symbols?: string[]) {
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

  public detectDataType(message: BinanceDexResponse<any>): DataType | undefined {
    if (message.stream === 'marketDiff' || message.stream === 'depthSnapshot') {
      return 'book_change'
    }

    if (message.stream === 'trades') {
      return 'trade'
    }

    return
  }

  protected *mapOrderBookChanges(
    message: BinanceDexResponse<BinanceDexDepthSnapshotData | BinanceDexMarketDiffData>,
    localTimestamp: Date
  ): IterableIterator<BookChange> {
    if ('symbol' in message.data) {
      // we've got snapshot message
      yield {
        type: 'book_change',
        symbol: message.data.symbol,
        isSnapshot: true,
        bids: message.data.bids.map(this._mapBookLevel),
        asks: message.data.asks.map(this._mapBookLevel),
        timestamp: localTimestamp,
        localTimestamp
      }
    } else {
      // we've got update
      yield {
        type: 'book_change',
        symbol: message.data.s,
        isSnapshot: false,
        bids: message.data.b.map(this._mapBookLevel),
        asks: message.data.a.map(this._mapBookLevel),
        timestamp: new Date(message.data.E),
        localTimestamp
      }
    }
  }

  protected *mapTrades(binanceDexTradeResponse: BinanceDexResponse<BinanceDexTradeData>, localTimestamp: Date): IterableIterator<Trade> {
    for (const binanceDexTrade of binanceDexTradeResponse.data) {
      yield {
        type: 'trade',
        symbol: binanceDexTrade.s,
        id: binanceDexTrade.t,
        price: Number(binanceDexTrade.p),
        amount: Number(binanceDexTrade.q),
        side: binanceDexTrade.tt == 2 ? 'sell' : 'buy',
        timestamp: new Date(Math.floor(binanceDexTrade.T / 1000000)),
        localTimestamp: localTimestamp
      }
    }
  }

  private _mapBookLevel(level: BinanceDexBookLevel) {
    const price = Number(level[0])
    const amount = Number(level[1])
    return { price, amount }
  }
}

type BinanceDexResponse<T> = {
  stream: string
  data: T
}

type BinanceDexTradeData = {
  s: string // Symbol
  t: string // Trade ID
  p: string // Price
  q: string // Quantity
  T: number // Trade time

  tt: number //tiekertype 0: Unknown 1: SellTaker 2: BuyTaker 3: BuySurplus 4: SellSurplus 5: Neutral
}[]

type BinanceDexBookLevel = [string, string]

type BinanceDexDepthSnapshotData = {
  symbol: string
  bids: BinanceDexBookLevel[]
  asks: BinanceDexBookLevel[]
}

type BinanceDexMarketDiffData = {
  E: number // Event time
  s: string // Symbol
  b: BinanceDexBookLevel[]
  a: BinanceDexBookLevel[]
}
