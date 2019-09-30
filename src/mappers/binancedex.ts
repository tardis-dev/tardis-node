import { DataType, Mapper, L2Change, Quote, Ticker, Trade } from './mapper'
import { FilterForExchange } from '../consts'

// https://docs.binance.org/api-reference/dex-api/ws-streams.html

export class BinanceDexMapper extends Mapper {
  private readonly _dataTypeChannelsMapping: { [key in DataType]?: FilterForExchange['binance-dex']['channel'][] } = {
    trade: ['trades'],
    ticker: ['ticker']
  }

  public getSupportedDataTypes(): DataType[] {
    return ['trade', 'ticker']
  }

  public getFiltersForDataTypeAndSymbols(dataType: DataType, symbols?: string[]) {
    if (!this.getSupportedDataTypes().includes(dataType)) {
      throw new Error(`BinanceDex mapper does not support normalized ${dataType} data`)
    }

    const matchingChannels = this._dataTypeChannelsMapping[dataType]!

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

  public getDataType(message: BinanceDexResponse<any>): DataType | undefined {
    if (message.stream == 'ticker') {
      return 'ticker'
    }
    if (message.stream == 'trades') {
      return 'trade'
    }

    return
  }

  protected mapQuotes(): IterableIterator<Quote> {
    throw new Error('normalized quotes not supported.')
  }

  protected mapL2OrderBookChanges(): IterableIterator<L2Change> {
    throw new Error('normalized l2changes not supported.')
  }

  protected *mapTickers(
    binanceDexTickerResponse: BinanceDexResponse<BinanceDexTickerData>,
    localTimestamp: Date
  ): IterableIterator<Ticker> {
    const binanceDexTicker = binanceDexTickerResponse.data
    yield {
      type: 'ticker',
      symbol: binanceDexTicker.s,
      bestBidPrice: Number(binanceDexTicker.b),
      bestAskPrice: Number(binanceDexTicker.a),
      lastPrice: Number(binanceDexTicker.c),
      timestamp: new Date(binanceDexTicker.E),
      localTimestamp
    }
  }

  protected *mapTrades(binanceDexTradeResponse: BinanceDexResponse<BinanceDexTradeData>, localTimestamp: Date): IterableIterator<Trade> {
    for (const binanceDexTrade of binanceDexTradeResponse.data) {
      yield {
        type: 'trade',
        id: binanceDexTrade.t,
        symbol: binanceDexTrade.s,
        price: Number(binanceDexTrade.p),
        amount: Number(binanceDexTrade.q),
        side: binanceDexTrade.tt == 2 ? 'sell' : 'buy',
        timestamp: new Date(Math.floor(binanceDexTrade.T / 1000000)),
        localTimestamp
      }
    }
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

type BinanceDexTickerData = {
  E: number // Event time
  s: string // Symbol
  c: string // Current day's close price
  b: string // Best bid price
  a: string // Best ask price
}
