import { Trade, Quote, L2Change, Ticker, Message, DataType, Filter } from '../types'

export abstract class Mapper {
  public map(message: any, localTimestamp: Date = new Date()): IterableIterator<Message> | undefined {
    const dataType = this.detectDataType(message)
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

  public supports(dataType: DataType) {
    return this.getSupportedDataTypes().includes(dataType)
  }

  public abstract getFiltersForDataTypeAndSymbols(dataType: DataType, symbols?: string[]): Filter<string>[]

  protected abstract detectDataType(message: any): DataType | undefined

  protected abstract mapTrades(message: any, localTimestamp: Date): IterableIterator<Trade>

  protected abstract mapQuotes(message: any, localTimestamp: Date): IterableIterator<Quote>

  protected abstract mapL2OrderBookChanges(message: any, localTimestamp: Date): IterableIterator<L2Change>

  protected abstract mapTickers(message: any, localTimestamp: Date): IterableIterator<Ticker>
}
