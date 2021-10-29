import { EXCHANGES, EXCHANGE_CHANNELS_INFO } from './consts'

export type Exchange = typeof EXCHANGES[number]

export type FilterForExchange = { [key in Exchange]: Filter<typeof EXCHANGE_CHANNELS_INFO[key][number]> }

export type Filter<T> = {
  channel: T
  symbols?: string[]
}

export type Writeable<T> = { -readonly [P in keyof T]: T[P] }

export type NormalizedData = {
  readonly type: string
  readonly symbol: string
  readonly exchange: Exchange
  readonly timestamp: Date
  readonly localTimestamp: Date
  readonly name?: string
}

export type Trade = {
  readonly type: 'trade'
  readonly symbol: string
  readonly exchange: Exchange
  readonly id: string | undefined
  readonly price: number
  readonly amount: number
  readonly side: 'buy' | 'sell' | 'unknown' // liquidity taker side (aggressor)
  readonly timestamp: Date
  readonly localTimestamp: Date
}

export type BookPriceLevel = {
  readonly price: number
  readonly amount: number
}

export type BookChange = {
  readonly type: 'book_change'
  readonly symbol: string
  readonly exchange: Exchange
  readonly isSnapshot: boolean
  readonly bids: BookPriceLevel[]
  readonly asks: BookPriceLevel[]

  readonly timestamp: Date
  readonly localTimestamp: Date
}

export type DerivativeTicker = {
  readonly type: 'derivative_ticker'
  readonly symbol: string
  readonly exchange: Exchange
  readonly lastPrice: number | undefined
  readonly openInterest: number | undefined
  readonly fundingRate: number | undefined
  readonly fundingTimestamp: Date | undefined
  readonly predictedFundingRate: number | undefined
  readonly indexPrice: number | undefined
  readonly markPrice: number | undefined

  readonly timestamp: Date
  readonly localTimestamp: Date
}

export type BookTicker = {
  readonly type: 'book_ticker'
  readonly symbol: string
  readonly exchange: Exchange

  readonly askAmount: number | undefined
  readonly askPrice: number | undefined
  readonly bidPrice: number | undefined
  readonly bidAmount: number | undefined

  readonly timestamp: Date
  readonly localTimestamp: Date
}

export type OptionSummary = NormalizedData & {
  type: 'option_summary'
  optionType: 'put' | 'call'
  strikePrice: number

  expirationDate: Date

  bestBidPrice: number | undefined
  bestBidAmount: number | undefined
  bestBidIV: number | undefined

  bestAskPrice: number | undefined
  bestAskAmount: number | undefined
  bestAskIV: number | undefined

  lastPrice: number | undefined
  openInterest: number | undefined

  markPrice: number | undefined
  markIV: number | undefined

  delta: number | undefined
  gamma: number | undefined
  vega: number | undefined
  theta: number | undefined
  rho: number | undefined

  underlyingPrice: number | undefined
  underlyingIndex: string
}

export type Liquidation = {
  readonly type: 'liquidation'
  readonly symbol: string
  readonly exchange: Exchange
  readonly id: string | undefined
  readonly price: number
  readonly amount: number
  readonly side: 'buy' | 'sell'
  readonly timestamp: Date
  readonly localTimestamp: Date
}

export type Disconnect = {
  readonly type: 'disconnect'
  readonly exchange: Exchange
  readonly localTimestamp: Date
}

export type TradeBar = {
  readonly type: 'trade_bar'
  readonly symbol: string
  readonly exchange: Exchange
  readonly name: string
  readonly interval: number
  readonly kind: 'time' | 'volume' | 'tick'
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number
  readonly buyVolume: number
  readonly sellVolume: number

  readonly trades: number
  readonly vwap: number
  readonly openTimestamp: Date
  readonly closeTimestamp: Date

  readonly timestamp: Date
  readonly localTimestamp: Date
}

export type BookSnapshot = {
  readonly type: 'book_snapshot'
  readonly symbol: string
  readonly exchange: Exchange
  readonly name: string
  readonly depth: number
  readonly interval: number
  readonly grouping?: number
  readonly bids: Optional<BookPriceLevel>[]
  readonly asks: Optional<BookPriceLevel>[]

  readonly timestamp: Date
  readonly localTimestamp: Date
}

declare global {
  interface Date {
    μs?: number
  }
}

export type Optional<T> = { [P in keyof T]: T[P] | undefined }
