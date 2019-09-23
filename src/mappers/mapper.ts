import { FilterForExchange, Exchange } from '../consts'

export type DataType = 'trades' | 'bookChange' | 'quote' | 'ticker'

export abstract class Mapper<T extends Exchange> {
  constructor(protected readonly _symbols: string[]) {}

  abstract getDataType(message: any): DataType | undefined
  abstract getFilterForDataType(dataType: DataType): FilterForExchange[T]
  abstract mapTrades(localTimestamp: Date, message: any): IterableIterator<Trade>
  abstract mapQuote(localTimestamp: Date, message: any): Quote
  abstract mapBookChange(localTimestamp: Date, message: any): BookChange
  abstract mapTicker(localTimestamp: Date, message: any): Ticker
}

export type Trade = {
  id: string
  symbol: string
  price: number
  amount: number
  side: 'buy' | 'sell' // liquidity taker side (aggressor)
  timestamp: Date
  localTimestamp: Date
}

export type BookChange = {
  symbol: string
  bids: [number, number][]
  asks: [number, number][]
  timestamp: Date
  localTimestamp: Date
}

export type Quote = {
  symbol: string
  bestBidPrice: number
  bestBidAmount: number
  bestAskPrice: number
  bestAskAmount: number
  timestamp: Date
  localTimestamp: Date
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
  localTimestamp: Date
}
