import { asNumberIfValid, asNumberOrUndefined } from '../handy.ts'
import { BookChange, BookPriceLevel, BookTicker, DerivativeTicker, OptionSummary, Trade } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'

export class BullishTradesMapper implements Mapper<'bullish', Trade> {
  canHandle(message: BullishMessage): message is BullishAnonymousTradeUpdateMessage {
    return message.dataType === 'V1TAAnonymousTradeUpdate' && message.type === 'update'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'V1TAAnonymousTradeUpdate' as const,
        symbols
      }
    ]
  }

  *map(message: BullishAnonymousTradeUpdateMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const trade of message.data.trades) {
      yield {
        type: 'trade',
        symbol: trade.symbol,
        exchange: 'bullish',
        id: trade.tradeId,
        price: Number(trade.price),
        amount: Number(trade.quantity),
        side: trade.side.toLowerCase() as 'buy' | 'sell',
        timestamp: new Date(trade.createdAtDatetime),
        localTimestamp
      }
    }
  }
}

export class BullishBookChangeMapper implements Mapper<'bullish', BookChange> {
  canHandle(message: BullishMessage): message is BullishLevel2Message {
    return message.dataType === 'V1TALevel2' && message.type === 'update'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'V1TALevel2' as const,
        symbols
      }
    ]
  }

  *map(message: BullishLevel2Message, localTimestamp: Date): IterableIterator<BookChange> {
    yield {
      type: 'book_change',
      symbol: message.data.symbol,
      exchange: 'bullish',
      isSnapshot: message.type === 'snapshot',
      bids: this.mapLevels(message.data.bids),
      asks: this.mapLevels(message.data.asks),
      timestamp: new Date(message.data.datetime),
      localTimestamp
    }
  }

  private mapLevels(levels: string[]): BookPriceLevel[] {
    const result = new Array<BookPriceLevel>(levels.length / 2)
    for (let index = 0, resultIndex = 0; index < levels.length; index += 2, resultIndex++) {
      result[resultIndex] = {
        price: Number(levels[index]),
        amount: Number(levels[index + 1])
      }
    }

    return result
  }
}

export class BullishBookTickerMapper implements Mapper<'bullish', BookTicker> {
  canHandle(message: BullishMessage): message is BullishLevel1Message {
    return message.dataType === 'V1TALevel1' && (message.type === 'snapshot' || message.type === 'update')
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'V1TALevel1' as const,
        symbols
      }
    ]
  }

  *map(message: BullishLevel1Message, localTimestamp: Date): IterableIterator<BookTicker> {
    yield {
      type: 'book_ticker',
      symbol: message.data.symbol,
      exchange: 'bullish',
      bidPrice: asNumberIfValid(message.data.bid[0]),
      bidAmount: asNumberIfValid(message.data.bid[1]),
      askPrice: asNumberIfValid(message.data.ask[0]),
      askAmount: asNumberIfValid(message.data.ask[1]),
      timestamp: new Date(message.data.datetime),
      localTimestamp
    }
  }
}

export class BullishDerivativeTickerMapper implements Mapper<'bullish', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()
  private readonly indexPrices = new Map<string, { price: number; timestamp: Date }>()

  canHandle(message: BullishMessage): message is BullishDerivativeTickerMessage | BullishIndexPriceMessage {
    if (message.dataType === 'V1TAIndexPrice' && (message.type === 'snapshot' || message.type === 'update')) {
      return true
    }

    if (message.dataType === 'V1TATickerResponse' && (message.type === 'snapshot' || message.type === 'update')) {
      const tickerMessage = message as BullishTickerMessage

      return tickerMessage.data.symbol.endsWith('-PERP') || /-\d{8}$/.test(tickerMessage.data.symbol)
    }

    return false
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'V1TATickerResponse' as const,
        symbols
      },
      {
        channel: 'V1TAIndexPrice' as const,
        symbols: symbols === undefined ? undefined : [...new Set(symbols.map((symbol) => symbol.split('-')[0]))]
      }
    ]
  }

  *map(message: BullishDerivativeTickerMessage | BullishIndexPriceMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    if (message.dataType === 'V1TAIndexPrice') {
      const price = asNumberIfValid(message.data.price)
      if (price !== undefined) {
        this.indexPrices.set(message.data.assetSymbol, {
          price,
          timestamp: new Date(message.data.updatedAtDatetime)
        })
      }

      return
    }

    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.data.symbol, 'bullish')
    const indexAsset = message.data.symbol.split('-')[0]
    const indexPrice = this.indexPrices.get(indexAsset)

    pendingTickerInfo.updateLastPrice(asNumberIfValid(message.data.last))
    pendingTickerInfo.updateMarkPrice(asNumberIfValid(message.data.markPrice))
    pendingTickerInfo.updateFundingRate(asNumberOrUndefined(message.data.fundingRate))
    pendingTickerInfo.updateOpenInterest(asNumberOrUndefined(message.data.openInterest))
    pendingTickerInfo.updateIndexPrice(indexPrice?.price)

    if (pendingTickerInfo.hasChanged()) {
      pendingTickerInfo.updateTimestamp(new Date(message.data.createdAtDatetime))
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

export class BullishOptionSummaryMapper implements Mapper<'bullish', OptionSummary> {
  private readonly indexPrices = new Map<string, { price: number; timestamp: Date }>()

  canHandle(message: BullishMessage): message is BullishOptionTickerMessage | BullishIndexPriceMessage {
    if (message.dataType === 'V1TAIndexPrice' && (message.type === 'snapshot' || message.type === 'update')) {
      return true
    }

    if (message.dataType === 'V1TATickerResponse' && (message.type === 'snapshot' || message.type === 'update')) {
      const tickerMessage = message as BullishTickerMessage

      return tickerMessage.data.symbol.endsWith('-C') || tickerMessage.data.symbol.endsWith('-P')
    }

    return false
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'V1TATickerResponse' as const,
        symbols
      },
      {
        channel: 'V1TAIndexPrice' as const,
        symbols: symbols === undefined ? undefined : [...new Set(symbols.map((symbol) => symbol.split('-')[0]))]
      }
    ]
  }

  *map(message: BullishOptionTickerMessage | BullishIndexPriceMessage, localTimestamp: Date): IterableIterator<OptionSummary> {
    if (message.dataType === 'V1TAIndexPrice') {
      const price = asNumberIfValid(message.data.price)
      if (price !== undefined) {
        this.indexPrices.set(message.data.assetSymbol, {
          price,
          timestamp: new Date(message.data.updatedAtDatetime)
        })
      }

      return
    }

    const [indexAsset, , dateText, strikePriceText, optionType] = message.data.symbol.split('-')
    const indexPrice = this.indexPrices.get(indexAsset)

    const expirationDate = new Date(`${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}Z`)
    expirationDate.setUTCHours(8)

    yield {
      type: 'option_summary',
      symbol: message.data.symbol,
      exchange: 'bullish',
      optionType: optionType === 'P' ? 'put' : 'call',
      strikePrice: Number(strikePriceText),
      expirationDate,
      bestBidPrice: asNumberIfValid(message.data.bestBid),
      bestBidAmount: asNumberIfValid(message.data.bidVolume),
      bestBidIV: undefined,
      bestAskPrice: asNumberIfValid(message.data.bestAsk),
      bestAskAmount: asNumberIfValid(message.data.askVolume),
      bestAskIV: undefined,
      lastPrice: asNumberIfValid(message.data.last),
      openInterest: asNumberOrUndefined(message.data.openInterest),
      markPrice: asNumberOrUndefined(message.data.markPrice),
      markIV: asNumberIfValid(message.data.impliedVolatility),
      delta: asNumberOrUndefined(message.data.delta),
      gamma: asNumberOrUndefined(message.data.gamma),
      vega: asNumberOrUndefined(message.data.vega),
      theta: asNumberOrUndefined(message.data.theta),
      rho: undefined,
      underlyingPrice: indexPrice?.price,
      underlyingIndex: '',
      timestamp: new Date(message.data.createdAtDatetime),
      localTimestamp
    }
  }
}

type BullishMessage = BullishDataMessage<string, unknown>
type BullishDataMessage<TDataType extends string, TData> = {
  type: BullishMessageRole
  dataType: TDataType
  data: TData
}
type BullishMessageRole = 'snapshot' | 'update'

type BullishAnonymousTradeUpdateMessage = BullishDataMessage<'V1TAAnonymousTradeUpdate', BullishAnonymousTradeUpdateData>
type BullishLevel2Message = BullishDataMessage<'V1TALevel2', BullishLevel2Data>
type BullishLevel1Message = BullishDataMessage<'V1TALevel1', BullishLevel1Data>
type BullishTickerMessage = BullishDataMessage<'V1TATickerResponse', BullishTickerData>
type BullishDerivativeTickerMessage = BullishDataMessage<'V1TATickerResponse', BullishDerivativeTickerData>
type BullishOptionTickerMessage = BullishDataMessage<'V1TATickerResponse', BullishOptionTickerData>
type BullishIndexPriceMessage = BullishDataMessage<'V1TAIndexPrice', BullishIndexPriceData>

type BullishAnonymousTradeUpdateData = {
  symbol: string
  createdAtTimestamp: string
  publishedAtTimestamp: string
  trades: BullishAnonymousTrade[]
}
type BullishAnonymousTrade = {
  symbol: string
  tradeId: string
  price: string
  quantity: string
  side: BullishTradeSide
  isTaker: boolean
  createdAtTimestamp: string
  publishedAtTimestamp: string
  lastUpdatedTimestamp: string
  createdAtDatetime: string
}
type BullishTradeSide = 'BUY' | 'SELL'

type BullishLevel2Data = {
  timestamp: string
  bids: string[]
  asks: string[]
  publishedAtTimestamp: string
  datetime: string
  sequenceNumberRange: [number, number]
  symbol: string
}

type BullishLevel1Data = {
  timestamp: string
  bid: [string, string]
  ask: [string, string]
  publishedAtTimestamp: string
  datetime: string
  sequenceNumber: string
  symbol: string
}

type BullishIndexPriceData = {
  price: string
  assetSymbol: string
  updatedAtDatetime: string
  updatedAtTimestamp: string
}

type BullishTickerData = BullishSpotTickerData | BullishDerivativeTickerData | BullishOptionTickerData

type BullishSpotTickerData = BullishTickerDataBase

type BullishDerivativeTickerData = BullishTickerDataBase & {
  markPrice: string | null
  fundingRate?: string | null
  openInterest: string | null
  openInterestUSD: string | null
}

type BullishOptionTickerData = BullishTickerDataBase & {
  markPrice: string | null
  openInterest: string | null
  openInterestUSD: string | null
  delta: string | null
  gamma: string | null
  theta: string | null
  vega: string | null
  impliedVolatility: string | null
}

type BullishTickerDataBase = {
  askVolume: string | null
  average: string | null
  baseVolume: string
  bestAsk?: string | null
  bestBid?: string | null
  bidVolume?: string | null
  change: string
  close: string | null
  createdAtTimestamp: string
  publishedAtTimestamp: string
  high: string | null
  last: string | null
  lastTradeDatetime: string | null
  lastTradeSize: string
  low: string | null
  open: string | null
  percentage: string
  quoteVolume: string
  symbol: string
  type: 'ticker'
  vwap: string | null
  currentPrice: string | null
  ammData: BullishTickerAmmData[] | null
  createdAtDatetime: string
  otcBaseVolume: string
}

type BullishTickerAmmData = {
  feeTierId: string
  tierPrice: string
  currentPrice: string
  bidSpreadFee: string
  askSpreadFee: string
}
