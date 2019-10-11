import { Computable } from './computable'
import { TradeBin, Trade } from '../types'

const DATE_MIN = new Date(-1)

export abstract class TradeBinComputable implements Computable<TradeBin, 'trade'> {
  public readonly sourceDataType = 'trade'

  protected inProgressBin: Writeable<TradeBin>

  constructor(public readonly name: string) {
    this.inProgressBin = {} as any
    this._reset()
  }

  public abstract hasNewSample(timestamp: Date): boolean

  public getSample(localTimestamp: Date) {
    this.inProgressBin.localTimestamp = localTimestamp
    const sample = { ...this.inProgressBin }
    this._reset()

    return sample
  }

  public update(trade: Trade) {
    const inProgressBin = this.inProgressBin
    const isNotOpenedYet = inProgressBin.trades === 0

    if (isNotOpenedYet) {
      inProgressBin.symbol = trade.symbol
      inProgressBin.open = trade.price
      inProgressBin.openTimestamp = trade.timestamp
    }

    if (inProgressBin.high < trade.price) {
      inProgressBin.high = trade.price
    }
    if (inProgressBin.low > trade.price) {
      inProgressBin.low = trade.price
    }

    inProgressBin.close = trade.price
    inProgressBin.closeTimestamp = trade.timestamp

    inProgressBin.buyVolume += trade.side === 'buy' ? trade.amount : 0
    inProgressBin.sellVolume += trade.side === 'sell' ? trade.amount : 0
    inProgressBin.trades += 1
    inProgressBin.vwap = (inProgressBin.vwap * inProgressBin.volume + trade.price * trade.amount) / (inProgressBin.volume + trade.amount)
    // volume needs to be updated after vwap otherwise vwap calc will go wrong
    inProgressBin.volume += trade.amount
    inProgressBin.binTimestamp = trade.timestamp
  }

  private _reset() {
    const binToReset = this.inProgressBin
    binToReset.type = this.name
    binToReset.symbol = ''
    binToReset.open = 0
    binToReset.high = Number.MIN_SAFE_INTEGER
    binToReset.low = Number.MAX_SAFE_INTEGER
    binToReset.close = 0

    binToReset.volume = 0
    binToReset.buyVolume = 0
    binToReset.sellVolume = 0

    binToReset.trades = 0
    binToReset.vwap = 0
    binToReset.openTimestamp = DATE_MIN
    binToReset.closeTimestamp = DATE_MIN
    binToReset.localTimestamp = DATE_MIN
    binToReset.binTimestamp = DATE_MIN
  }
}

export class TimeTradeBinComputable extends TradeBinComputable {
  private _timeIntervalMS: number

  constructor(name: string, intervalMS: number) {
    super(name)
    this._timeIntervalMS = intervalMS
  }

  public hasNewSample(currentTimestamp: Date): boolean {
    if (this.inProgressBin.trades === 0) {
      return false
    }

    const currentTimestampTimeBucket = this._getTimeBucket(currentTimestamp)
    const closeTimestampTimeBucket = this._getTimeBucket(this.inProgressBin.closeTimestamp)
    if (currentTimestampTimeBucket > closeTimestampTimeBucket) {
      // set bin timestamp to end of 'interval' rounded
      this.inProgressBin.binTimestamp = new Date(currentTimestampTimeBucket * this._timeIntervalMS)

      return true
    }

    return false
  }

  private _getTimeBucket(timestamp: Date) {
    return Math.floor(timestamp.valueOf() / this._timeIntervalMS)
  }
}

export class TickTradeBinComputable extends TradeBinComputable {
  private readonly _tickCountThreshold: number

  constructor(name: string, tickCount: number) {
    super(name)
    this._tickCountThreshold = tickCount
  }

  public hasNewSample() {
    if (this.inProgressBin.trades === 0) {
      return false
    }

    return this.inProgressBin.trades >= this._tickCountThreshold
  }
}

export class VolumeTradeBinComputable extends TradeBinComputable {
  private readonly _volumeThreshold: number

  constructor(name: string, volumeThreshold: number) {
    super(name)
    this._volumeThreshold = volumeThreshold
  }

  public hasNewSample() {
    if (this.inProgressBin.trades === 0) {
      return false
    }

    return this.inProgressBin.volume >= this._volumeThreshold
  }
}

type Writeable<T> = { -readonly [P in keyof T]: T[P] }
