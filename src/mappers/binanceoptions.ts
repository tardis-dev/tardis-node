import { asNumberIfValid, upperCaseSymbols } from '../handy'
import { BookChange, OptionSummary, Trade } from '../types'
import { Mapper } from './mapper'

// https://github.com/binance-exchange/binance-official-api-docs/blob/master/web-socket-streams.md

export class BinanceOptionsTradesMapper implements Mapper<'binance-options', Trade> {
  private readonly _lastTradeId = new Map<string, number>()
  canHandle(message: BinanceResponse<any>) {
    if (message.stream === undefined) {
      return false
    }

    return message.stream.endsWith('@TRADE')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'TRADE',
        symbols
      } as const
    ]
  }

  *map(binanceTradeResponse: BinanceResponse<BinanceOptionsTradeData>, localTimestamp: Date) {
    const symbol = binanceTradeResponse.data.s
    for (const optionsTrade of binanceTradeResponse.data.t) {
      // binance options does not only return real-time trade as it happens but just snapshot of last 'x' trades always
      // so we need to decide which are real-time trades and which are stale/already processed

      const timestamp = new Date(optionsTrade.T)
      const tradeIdNumeric = Number(optionsTrade.t)

      const lastProcessedTradeId = this._lastTradeId.get(symbol)
      const isAlreadyProcessed = lastProcessedTradeId !== undefined && lastProcessedTradeId >= tradeIdNumeric
      const isStaleTrade = localTimestamp.valueOf() - timestamp.valueOf() > 10000

      if (isAlreadyProcessed || isStaleTrade) {
        continue
      }

      this._lastTradeId.set(symbol, Number(optionsTrade.t))
      const trade: Trade = {
        type: 'trade',
        symbol,
        exchange: 'binance-options',
        id: optionsTrade.t,
        price: Number(optionsTrade.p),
        amount: Number(optionsTrade.q),
        side: optionsTrade.s === '-1' ? 'sell' : 'buy',
        timestamp,
        localTimestamp: localTimestamp
      }

      yield trade
    }
  }
}

export class BinanceOptionsBookChangeMapper implements Mapper<'binance-options', BookChange> {
  canHandle(message: BinanceResponse<any>) {
    if (message.stream === undefined) {
      return false
    }

    return message.stream.endsWith('@DEPTH100')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'DEPTH100',
        symbols
      } as const
    ]
  }

  *map(message: BinanceResponse<BinanceOptionsDepthData>, localTimestamp: Date) {
    const bookChange: BookChange = {
      type: 'book_change',
      symbol: message.data.s,
      exchange: 'binance-options',
      isSnapshot: true,
      bids: message.data.b.map(this.mapBookLevel),
      asks: message.data.a.map(this.mapBookLevel),
      timestamp: new Date(message.data.E),
      localTimestamp
    }

    yield bookChange
  }

  protected mapBookLevel(level: BinanceBookLevel) {
    const price = Number(level[0])
    const amount = Number(level[1])
    return { price, amount }
  }
}

export class BinanceOptionSummaryMapper implements Mapper<'binance-options', OptionSummary> {
  private readonly _indexPrices = new Map<string, number>()
  canHandle(message: BinanceResponse<any>) {
    if (message.stream === undefined) {
      return false
    }

    return message.stream.endsWith('@TICKER') || message.stream.endsWith('@INDEX')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    const indexes =
      symbols !== undefined
        ? symbols.map((s) => {
            const symbolParts = s.split('-')
            return `${symbolParts[0]}USDT`
          })
        : undefined

    return [
      {
        channel: 'TICKER',
        symbols
      } as const,
      {
        channel: 'INDEX',
        symbols: indexes
      } as const
    ]
  }

  *map(message: BinanceResponse<BinanceOptionsTickerData | BinanceOptionsIndexData>, localTimestamp: Date) {
    if (message.stream.endsWith('@INDEX')) {
      const lastIndexPrice = Number(message.data.p)
      if (lastIndexPrice > 0) {
        this._indexPrices.set(message.data.s, lastIndexPrice)
      }
      return
    }

    const optionInfo = message.data as BinanceOptionsTickerData

    const [base, expiryPart, strikePrice, optionType] = optionInfo.s.split('-')

    const expirationDate = new Date(`20${expiryPart.slice(0, 2)}-${expiryPart.slice(2, 4)}-${expiryPart.slice(4, 6)}Z`)
    expirationDate.setUTCHours(8)

    const isPut = optionType === 'P'

    const underlyingIndex = `${base}USDT`

    let bestBidPrice = asNumberIfValid(optionInfo.bo)
    if (bestBidPrice === 0) {
      bestBidPrice = undefined
    }

    let bestAskPrice = asNumberIfValid(optionInfo.ao)
    if (bestAskPrice === 0) {
      bestAskPrice = undefined
    }

    let bestBidIV = bestBidPrice !== undefined ? asNumberIfValid(optionInfo.b) : undefined
    if (bestBidIV === -1) {
      bestBidIV = undefined
    }

    let bestAskIV = bestAskPrice !== undefined ? asNumberIfValid(optionInfo.a) : undefined
    if (bestAskIV === -1) {
      bestAskIV = undefined
    }

    const optionSummary: OptionSummary = {
      type: 'option_summary',
      symbol: optionInfo.s,
      exchange: 'binance-options',
      optionType: isPut ? 'put' : 'call',
      strikePrice: Number(strikePrice),
      expirationDate,

      bestBidPrice,
      bestBidAmount: undefined,
      bestBidIV,

      bestAskPrice,
      bestAskAmount: undefined,
      bestAskIV,

      lastPrice: asNumberIfValid(optionInfo.c),
      openInterest: undefined,

      markPrice: asNumberIfValid(optionInfo.mp),
      markIV: undefined,

      delta: asNumberIfValid(optionInfo.d),
      gamma: asNumberIfValid(optionInfo.g),
      vega: asNumberIfValid(optionInfo.v),
      theta: asNumberIfValid(optionInfo.t),
      rho: undefined,

      underlyingPrice: this._indexPrices.get(underlyingIndex),
      underlyingIndex,

      timestamp: new Date(optionInfo.E),
      localTimestamp: localTimestamp
    }

    yield optionSummary
  }
}

type BinanceResponse<T> = {
  stream: string
  data: T
}

type BinanceOptionsTradeData = {
  e: 'trade'
  E: number
  s: string
  t: { t: string; p: string; q: string; T: number; s: '-1' | '1' }[]
}

type BinanceOptionsDepthData = {
  e: 'depth'
  E: number
  s: string
  b: BinanceBookLevel[]
  a: BinanceBookLevel[]
}

type BinanceOptionsTickerData = {
  e: 'ticker' // event type
  E: 1591677962357 // event time
  s: 'BTC-200630-9000-P' // Option trading pair
  o: '1000' // 24-hour opening price
  h: '1000' // Highest price
  l: '1000' // Lowest price
  c: '1000' // latest price
  V: '2' // Trading volume
  A: '0' // trade amount
  p: '0' // price change
  Q: '2000' // volume of last completed trade
  F: 1 // first trade ID
  L: 1 // last trade ID
  n: 1 // number of trades
  b: '0' // BuyImplied volatility
  a: '0' // SellImplied volatility
  d: '0' // delta
  t: '0' // theta
  g: '0' // gamma
  v: '0' // vega,
  bo: '3.1' // best bid price
  ao: '90.36' // best ask price
  mp: '6.96' // mark price
}

type BinanceOptionsIndexData = { e: 'index'; E: 1614556800182; s: 'BTCUSDT'; p: '45160.127864' }

type BinanceBookLevel = [string, string]
