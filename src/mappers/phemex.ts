import { Mapper, PendingTickerInfoHelper } from './mapper'
import { Trade, BookChange, DerivativeTicker } from '../types'

// phemex provides timestamps in nanoseconds
const fromNanoSecondsToDate = (nanos: number) => {
  const microtimestamp = Math.floor(nanos / 1000)

  const timestamp = new Date(microtimestamp / 1000)
  timestamp.μs = microtimestamp % 1000

  return timestamp
}

function getPriceScale(symbol: string) {
  if (symbol.startsWith('s')) {
    return 1e8
  }

  return 1e4
}

function getQtyScale(symbol: string) {
  if (symbol.startsWith('s')) {
    return 1e8
  }

  return 1
}

function getSymbols(symbols?: string[]) {
  if (symbols === undefined) {
    return
  }
  return symbols.map((symbol) => {
    if (symbol.startsWith('S')) {
      return symbol.charAt(0).toLowerCase() + symbol.slice(1)
    }
    return symbol
  })
}

export const phemexTradesMapper: Mapper<'phemex', Trade> = {
  canHandle(message: PhemexTradeMessage) {
    return 'trades' in message && message.type === 'incremental'
  },

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'trades',
        symbols: getSymbols(symbols)
      } as const
    ]
  },

  *map(message: PhemexTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const [timestamp, side, priceEp, qty] of message.trades) {
      const symbol = message.symbol

      yield {
        type: 'trade',
        symbol: symbol.toUpperCase(),
        exchange: 'phemex',
        id: undefined,
        price: priceEp / getPriceScale(symbol),
        amount: qty / getQtyScale(symbol),
        side: side === 'Buy' ? 'buy' : 'sell',
        timestamp: fromNanoSecondsToDate(timestamp),
        localTimestamp: localTimestamp
      }
    }
  }
}

const mapBookLevelForSymbol =
  (symbol: string) =>
  ([priceEp, qty]: PhemexBookLevel) => {
    return {
      price: priceEp / getPriceScale(symbol),
      amount: qty / getQtyScale(symbol)
    }
  }

export const phemexBookChangeMapper: Mapper<'phemex', BookChange> = {
  canHandle(message: PhemexBookMessage) {
    return 'book' in message
  },

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'book',
        symbols: getSymbols(symbols)
      } as const
    ]
  },

  *map(message: PhemexBookMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const symbol = message.symbol
    const mapBookLevel = mapBookLevelForSymbol(symbol)
    yield {
      type: 'book_change',
      symbol: symbol.toUpperCase(),
      exchange: 'phemex',
      isSnapshot: message.type === 'snapshot',
      bids: message.book.bids.map(mapBookLevel),
      asks: message.book.asks.map(mapBookLevel),

      timestamp: fromNanoSecondsToDate(message.timestamp),
      localTimestamp
    }
  }
}

export class PhemexDerivativeTickerMapper implements Mapper<'phemex', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: PhemexTicker) {
    return 'market24h' in message
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'market24h',
        symbols
      } as const
    ]
  }

  *map(message: PhemexTicker, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.market24h.symbol, 'phemex')
    const phemexTicker = message.market24h
    pendingTickerInfo.updateFundingRate(phemexTicker.fundingRate / 100000000)
    pendingTickerInfo.updatePredictedFundingRate(phemexTicker.predFundingRate / 100000000)
    pendingTickerInfo.updateIndexPrice(phemexTicker.indexPrice / 10000)
    pendingTickerInfo.updateMarkPrice(phemexTicker.markPrice / 10000)
    pendingTickerInfo.updateOpenInterest(phemexTicker.openInterest)
    pendingTickerInfo.updateLastPrice(phemexTicker.close / 10000)
    pendingTickerInfo.updateTimestamp(fromNanoSecondsToDate(message.timestamp))

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

type PhemexTradeMessage = {
  symbol: string
  trades: [[number, 'Buy' | 'Sell', number, number]]
  type: 'incremental' | 'snapshot'
}

type PhemexBookLevel = [number, number]

type PhemexBookMessage = {
  book: {
    asks: PhemexBookLevel[]
    bids: PhemexBookLevel[]
  }

  symbol: string
  timestamp: number
  type: 'incremental' | 'snapshot'
}

type PhemexTicker = {
  market24h: {
    fundingRate: number
    indexPrice: number
    markPrice: number
    openInterest: number
    predFundingRate: number
    symbol: string
    close: number
  }

  timestamp: number
}
