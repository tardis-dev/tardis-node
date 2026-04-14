import { DerivativeTicker, Exchange, FilterForExchange, NormalizedData } from '../types.ts'

export type Mapper<T extends Exchange, U extends NormalizedData> = {
  initialize?: () => Promise<void>

  canHandle: (message: any) => boolean

  map(message: any, localTimestamp: Date): IterableIterator<U> | undefined

  getFilters: (symbols?: string[]) => FilterForExchange[T][]
}

export type MapperFactory<T extends Exchange, U extends NormalizedData> = (exchange: T, localTimestamp: Date) => Mapper<T, U>

export function createMappersFactory<T extends Exchange>(exchange: T, normalizers: MapperFactory<T, any>[]) {
  return async (localTimestamp: Date): Promise<Mapper<T, any>[]> => {
    if (normalizers.length === 0) {
      throw new Error(`Can't normalize data without any normalizers provided`)
    }
    const mappers = await Promise.all(
      normalizers.map(async (normalizerFactory) => {
        const mapper = normalizerFactory(exchange, localTimestamp)
        try {
          await mapper.initialize?.()
          return mapper
        } catch (err) {
          console.error(`mapper initialize failed for exchange "${exchange}", excluding from pipeline:`, err)
          return undefined
        }
      })
    )
    return mappers.filter((m): m is Mapper<T, any> => m !== undefined)
  }
}

type Writeable<T> = { -readonly [P in keyof T]: T[P] }

const isNullOrUndefined = (input: number | Date | undefined | null): input is null | undefined => input === undefined || input === null

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
  public hasPendingTickerInfo(symbol: string) {
    return this._pendingTickers.has(symbol)
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
      fundingTimestamp: undefined,
      predictedFundingRate: undefined,
      indexPrice: undefined,
      markPrice: undefined,
      timestamp: undefined as any,
      localTimestamp: new Date()
    }

    this._hasChanged = false
  }

  public getCurrentFundingTimestamp() {
    return this._pendingTicker.fundingTimestamp
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

  public updatePredictedFundingRate(predictedFundingRate: number | undefined | null) {
    if (isNullOrUndefined(predictedFundingRate)) {
      return
    }

    if (this._pendingTicker.predictedFundingRate !== predictedFundingRate) {
      this._pendingTicker.predictedFundingRate = predictedFundingRate
      this._hasChanged = true
    }
  }

  public updateFundingTimestamp(fundingTimestamp: Date | undefined | null) {
    if (isNullOrUndefined(fundingTimestamp)) {
      return
    }

    if (
      this._pendingTicker.fundingTimestamp === undefined ||
      this._pendingTicker.fundingTimestamp.valueOf() !== fundingTimestamp.valueOf()
    ) {
      this._pendingTicker.fundingTimestamp = fundingTimestamp
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

  public updateTimestamp(timestamp: Date) {
    if (this._pendingTicker.timestamp === undefined || this._pendingTicker.timestamp.valueOf() <= timestamp.valueOf()) {
      this._pendingTicker.timestamp = timestamp
    }
  }

  public hasChanged() {
    return this._hasChanged
  }

  public getSnapshot(localTimestamp: Date): DerivativeTicker {
    this._hasChanged = false
    this._pendingTicker.localTimestamp = localTimestamp

    if (this._pendingTicker.timestamp === undefined) {
      this._pendingTicker.timestamp = localTimestamp
    }

    return { ...this._pendingTicker }
  }
}
