import { asNumberIfValid } from '../handy.ts'
import { BookChange, BookPriceLevel, BookTicker, OptionSummary, Trade } from '../types.ts'
import { Mapper } from './mapper.ts'

export class BullishTradesMapper implements Mapper<'bullish', Trade> {
  canHandle(message: BullishMessage): message is BullishAnonymousTradeUpdateMessage {
    return message.dataType === 'V1TAAnonymousTradeUpdate' && (message.type === 'snapshot' || message.type === 'update')
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
    return message.dataType === 'V1TALevel2' && (message.type === 'snapshot' || message.type === 'update')
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
    return levels.reduce<BookPriceLevel[]>((result, value, index) => {
      if (index % 2 === 0) {
        result.push({
          price: Number(value),
          amount: Number(levels[index + 1])
        })
      }

      return result
    }, [])
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

export class BullishOptionSummaryMapper implements Mapper<'bullish', OptionSummary> {
  canHandle(message: BullishMessage): message is BullishOptionTickerMessage {
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
      }
    ]
  }

  *map(message: BullishOptionTickerMessage, localTimestamp: Date): IterableIterator<OptionSummary> {
    const [, , dateText, strikePriceText, optionType] = message.data.symbol.split('-')

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
      openInterest: asNumberIfValid(message.data.openInterest),
      markPrice: asNumberIfValid(message.data.markPrice),
      markIV: asNumberIfValid(message.data.impliedVolatility),
      delta: asNumberIfValid(message.data.delta),
      gamma: asNumberIfValid(message.data.gamma),
      vega: asNumberIfValid(message.data.vega),
      theta: asNumberIfValid(message.data.theta),
      rho: undefined,
      underlyingPrice: undefined,
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
type BullishOptionTickerMessage = BullishDataMessage<'V1TATickerResponse', BullishOptionTickerData>

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
