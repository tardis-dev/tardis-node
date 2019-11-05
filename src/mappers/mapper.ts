import { DerivativeTicker, Exchange, FilterForExchange, NormalizedData } from '../types'

export type Mapper<T extends Exchange, U extends NormalizedData> = {
  canHandle: (message: any) => boolean

  map(message: any, localTimestamp: Date): IterableIterator<U> | undefined

  getFilters: (symbols?: string[]) => FilterForExchange[T][]
}

export type MapperFactory<T extends Exchange, U extends NormalizedData> = (exchange: T, localTimestamp: Date) => Mapper<T, U>

type Writeable<T> = { -readonly [P in keyof T]: T[P] }

const isNullOrUndefined = (input: number | undefined | null): input is null | undefined => input === undefined || input === null

export class PendingTickerInfoHelper {
  private readonly _pendingTickers: Map<string, PendingDerivativeTickerInfo> = new Map()

  public getPendingTickerInfo(symbol: string, exchange: Exchange) {
    let pendingTickerInfo = this._pendingTickers.get(symbol)
    if (pendingTickerInfo === undefined) {
      pendingTickerInfo = new PendingDerivativeTickerInfo(symbol, exchange)
      this._pendingTickers.set(symbol, pendingTickerInfo)
    }

    return pendingTickerInfo
  }
}

class PendingDerivativeTickerInfo {
  private _pendingTicker: Writeable<DerivativeTicker>
  private _hasChanged: boolean

  constructor(symbol: string, exchange: Exchange) {
    this._pendingTicker = {
      type: 'derivative_ticker',
      symbol,
      exchange,
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
