import { Trade, BookChange, DerivativeTicker, Message, DataType, Filter } from '../types'

export type Mapper = {
  map(message: any, localTimestamp: Date): IterableIterator<Message> | undefined
  getFiltersForDataTypeAndSymbols(dataType: DataType, symbols?: string[]): Filter<string>[]
  supportedDataTypes: readonly DataType[]
}

export abstract class MapperBase implements Mapper {
  private readonly _pendingTickers: Map<string, PendingDerivativeTickerInfo> = new Map()

  public map(message: any, localTimestamp: Date): IterableIterator<Message> | undefined {
    const dataType = this.detectDataType(message)
    if (dataType === undefined) {
      return
    }

    switch (dataType) {
      case 'book_change':
        return this.mapOrderBookChanges(message, localTimestamp)
      case 'trade':
        return this.mapTrades(message, localTimestamp)
      case 'derivative_ticker':
        return this.mapDerivativeTickerInfo(message, localTimestamp)
      default:
        return
    }
  }

  protected getPendingTickerInfo(symbol: string) {
    let pendingTickerInfo = this._pendingTickers.get(symbol)
    if (pendingTickerInfo === undefined) {
      pendingTickerInfo = new PendingDerivativeTickerInfo(symbol)
      this._pendingTickers.set(symbol, pendingTickerInfo)
    }

    return pendingTickerInfo
  }

  public getFiltersForDataTypeAndSymbols(dataType: DataType, symbols?: string[]) {
    if (!this.supportedDataTypes.includes(dataType)) {
      throw new Error(`${(this as {}).constructor.name} does not support ${dataType} data type`)
    }

    return this.mapDataTypeAndSymbolsToFilters(dataType, symbols)
  }

  public abstract supportedDataTypes: readonly DataType[]

  protected abstract mapDataTypeAndSymbolsToFilters(dataType: DataType, symbols?: string[]): Filter<string>[]

  protected abstract detectDataType(message: any): DataType | undefined

  protected abstract mapTrades(message: any, localTimestamp: Date): IterableIterator<Trade>

  protected abstract mapOrderBookChanges(message: any, localTimestamp: Date): IterableIterator<BookChange>

  protected mapDerivativeTickerInfo(_: any, __: Date): IterableIterator<DerivativeTicker> {
    throw new Error('mapDerivativeTickerInfo not implemented for mapper')
  }
}

const isNullOrUndefined = (input: number | undefined | null): input is null | undefined => input === undefined || input === null

class PendingDerivativeTickerInfo {
  private _pendingTicker: Writeable<DerivativeTicker>
  private _hasChanged: boolean

  constructor(symbol: string) {
    this._pendingTicker = {
      type: 'derivative_ticker',
      symbol,
      lastPrice: undefined,
      openInterest: undefined,
      fundingRate: undefined,
      indexPrice: undefined,
      markPrice: undefined,
      timestamp: new Date(),
      localTimestamp: new Date()
    }

    this._hasChanged = false
  }

  public updateOpenInterest(openInterest: number | undefined | null) {
    if (isNullOrUndefined(openInterest)) {
      return
    }

    if (this._pendingTicker.openInterest !== openInterest) {
      this._pendingTicker.openInterest = openInterest
      this._hasChanged = true
    }
  }

  public updateMarkPrice(markPrice: number | undefined | null) {
    if (isNullOrUndefined(markPrice)) {
      return
    }

    if (this._pendingTicker.markPrice !== markPrice) {
      this._pendingTicker.markPrice = markPrice
      this._hasChanged = true
    }
  }

  public updateFundingRate(fundingRate: number | undefined | null) {
    if (isNullOrUndefined(fundingRate)) {
      return
    }

    if (this._pendingTicker.fundingRate !== fundingRate) {
      this._pendingTicker.fundingRate = fundingRate
      this._hasChanged = true
    }
  }

  public updateIndexPrice(indexPrice: number | undefined | null) {
    if (isNullOrUndefined(indexPrice)) {
      return
    }

    if (this._pendingTicker.indexPrice !== indexPrice) {
      this._pendingTicker.indexPrice = indexPrice
      this._hasChanged = true
    }
  }

  public updateLastPrice(lastPrice: number | undefined | null) {
    if (isNullOrUndefined(lastPrice)) {
      return
    }

    if (this._pendingTicker.lastPrice !== lastPrice) {
      this._pendingTicker.lastPrice = lastPrice
      this._hasChanged = true
    }
  }

  public hasChanged() {
    return this._hasChanged
  }

  public getSnapshot(timestamp: Date, localTimestamp: Date): DerivativeTicker {
    this._hasChanged = false
    this._pendingTicker.timestamp = timestamp
    this._pendingTicker.localTimestamp = localTimestamp

    return { ...this._pendingTicker }
  }
}

type Writeable<T> = { -readonly [P in keyof T]: T[P] }
