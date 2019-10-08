import { EXCHANGES, EXCHANGE_CHANNELS_INFO } from './consts'

export type Exchange = typeof EXCHANGES[number]

export type FilterForExchange = { [key in Exchange]: Filter<typeof EXCHANGE_CHANNELS_INFO[key][number]> }

export type Filter<T> = {
  channel: T
  symbols?: string[]
}

export type Message = Trade | BookChange | DerivativeTicker

export type MessageForDataType = {
  trade: Trade
  book_change: BookChange
  derivative_ticker: DerivativeTicker
}

export type DataType = keyof MessageForDataType

export type Trade = Readonly<{
  type: 'trade'
  symbol: string
  id?: string
  price: number
  amount: number
  side: 'buy' | 'sell' | 'unknown' // liquidity taker side (aggressor)
  timestamp: Date
  localTimestamp: Date
}>

export type BookPriceLevel = Readonly<{
  price: number
  amount: number
}>

export type BookChange = Readonly<{
  type: 'book_change'
  symbol: string

  isSnapshot: boolean
  bids: BookPriceLevel[]
  asks: BookPriceLevel[]

  timestamp: Date
  localTimestamp: Date
}>

export type DerivativeTicker = Readonly<{
  type: 'derivative_ticker'
  symbol: string
  lastPrice?: number
  openInterest?: number
  fundingRate?: number
  indexPrice?: number
  markPrice?: number

  timestamp: Date
  localTimestamp: Date
}>
