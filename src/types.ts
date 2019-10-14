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
  exchange: Exchange
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
  exchange: Exchange
  isSnapshot: boolean
  bids: BookPriceLevel[]
  asks: BookPriceLevel[]

  timestamp: Date
  localTimestamp: Date
}>

export type DerivativeTicker = Readonly<{
  type: 'derivative_ticker'
  symbol: string
  exchange: Exchange
  lastPrice?: number
  openInterest?: number
  fundingRate?: number
  indexPrice?: number
  markPrice?: number

  timestamp: Date
  localTimestamp: Date
}>

export type TradeBin = Readonly<{
  type: 'trade_bin'
  symbol: string
  exchange: Exchange
  name: string
  binSize: number
  binBy: 'time' | 'volume' | 'ticks'
  open: number
  high: number
  low: number
  close: number
  volume: number
  buyVolume: number
  sellVolume: number

  trades: number
  vwap: number
  openTimestamp: Date
  closeTimestamp: Date

  binTimestamp: Date
  localTimestamp: Date
}>

export type BookSnapshot = {
  type: 'book_snapshot'
  symbol: string
  exchange: Exchange
  name: string
  depth: number
  interval: number

  bids: BookPriceLevel[]
  asks: BookPriceLevel[]

  timestamp: Date
  localTimestamp: Date
}
