import { EXCHANGES, EXCHANGE_CHANNELS_INFO } from './consts'

export type Exchange = typeof EXCHANGES[number]

export type FilterForExchange = { [key in Exchange]: Filter<typeof EXCHANGE_CHANNELS_INFO[key][number]> }

export type Filter<T> = {
  channel: T
  symbols?: string[]
}

export type Message = Quote | Trade | L2Change | Ticker

export type MessageForDataType = {
  trade: Trade
  l2change: L2Change
  quote: Quote
  ticker: Ticker
}

export type DataType = keyof MessageForDataType

export type Trade = {
  type: 'trade'
  id: string
  symbol: string
  price: number
  amount: number
  side: 'buy' | 'sell' // liquidity taker side (aggressor)
  timestamp: Date
  localTimestamp: Date
}

export type BookPriceLevel = {
  price: number
  amount: number
}

export type L2Change = {
  type: 'l2change'
  changeType: 'snapshot' | 'update'
  symbol: string
  bids: BookPriceLevel[]
  asks: BookPriceLevel[]

  timestamp: Date
  localTimestamp: Date
}

export type Quote = {
  type: 'quote'
  symbol: string
  bestBidPrice: number
  bestBidAmount: number
  bestAskPrice: number
  bestAskAmount: number
  timestamp: Date
  localTimestamp: Date
}

export type Ticker = {
  type: 'ticker'
  symbol: string
  bestBidPrice?: number
  bestAskPrice?: number
  lastPrice: number

  openInterest?: number
  fundingRate?: number
  indexPrice?: number
  markPrice?: number

  timestamp: Date
  localTimestamp: Date
}
