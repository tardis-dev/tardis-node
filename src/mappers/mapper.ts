import { Filter } from '../consts'

export type Message = Quote | Trade | L2Change | Ticker

export type MessageForDataType = {
  trade: Trade
  l2change: L2Change
  quote: Quote
  ticker: Ticker
}

export type DataType = keyof MessageForDataType

export abstract class Mapper {
  public map(message: any, localTimestamp: Date = new Date()): IterableIterator<Message> | undefined {
    const dataType = this.getDataType(message)
    if (!dataType) {
      return
    }

    switch (dataType) {
      case 'l2change':
        return this.mapL2OrderBookChanges(message, localTimestamp)
      case 'trade':
        return this.mapTrades(message, localTimestamp)
      case 'quote':
        return this.mapQuotes(message, localTimestamp)
      case 'ticker':
        return this.mapTickers(message, localTimestamp)
    }
  }

  public reset() {}

  public getSupportedDataTypes(): DataType[] {
    return ['trade', 'l2change', 'quote', 'ticker']
  }

  public abstract getFiltersForDataTypeAndSymbols(dataType: DataType, symbols?: string[]): Filter<string>[]

  protected abstract getDataType(message: any): DataType | undefined

  protected abstract mapTrades(message: any, localTimestamp: Date): IterableIterator<Trade>

  protected abstract mapQuotes(message: any, localTimestamp: Date): IterableIterator<Quote>

  protected abstract mapL2OrderBookChanges(message: any, localTimestamp: Date): IterableIterator<L2Change>

  protected abstract mapTickers(message: any, localTimestamp: Date): IterableIterator<Ticker>
}

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
