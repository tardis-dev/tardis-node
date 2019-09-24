import { FilterForExchange, Exchange } from '../consts'

export type DataType = 'trade' | 'l2Change' | 'quote' | 'ticker'

export type Mapper<T extends Exchange> = {
  getDataType(message: any): DataType | undefined

  getFiltersForDataTypeAndSymbols(dataType: DataType, symbols?: string[]): FilterForExchange[T][]

  mapTrades(message: any, localTimestamp?: Date): IterableIterator<Trade>

  mapQuotes(message: any, localTimestamp?: Date): IterableIterator<Quote>

  mapOrderBookL2Changes(message: any, localTimestamp?: Date): IterableIterator<OrderBookL2Change>

  mapTickers(message: any, localTimestamp?: Date): IterableIterator<Ticker>
}

export type Trade = {
  id: string
  symbol: string
  price: number
  amount: number
  side: 'buy' | 'sell' // liquidity taker side (aggressor)
  timestamp: Date
  localTimestamp?: Date
}

export type BookPriceLevel = {
  price: number
  amount: number
}

export type OrderBookL2Change = {
  symbol: string
  bids: BookPriceLevel[]
  asks: BookPriceLevel[]
  timestamp?: Date
  localTimestamp?: Date
}

export type Quote = {
  symbol: string
  bestBidPrice: number
  bestBidAmount: number
  bestAskPrice: number
  bestAskAmount: number
  timestamp: Date
  localTimestamp?: Date
}

export type Ticker = {
  symbol: string
  bestBidPrice: number
  bestAskPrice: number
  lastPrice: number
  volume: number

  openInterest?: number
  fundingRate?: number
  indexPrice?: number
  markPrice?: number

  timestamp: Date
  localTimestamp?: Date
}
