import { Computable } from './computable'
import { TradeBar, Trade } from '../types'

const DATE_MIN = new Date(-1)

type BarKind = 'time' | 'volume' | 'tick'

type TradeBarComputableOptions = { kind: BarKind; interval: number; name?: string }

export const computeTradeBars = (options: TradeBarComputableOptions) => () => new TradeBarComputable(options)

const kindSuffix: { [key in BarKind]: string } = {
  tick: 'ticks',
  time: 'ms',
  volume: 'vol'
}
class TradeBarComputable implements Computable<TradeBar> {
  public readonly sourceDataTypes = ['trade']

  protected inProgressBar: Writeable<TradeBar>
  private readonly _kind: BarKind
  private readonly _interval: number
  private readonly _name: string
  private readonly _type = 'trade_bar'

  constructor({ kind, interval, name }: TradeBarComputableOptions) {
    this._kind = kind
    this._interval = interval

    if (name === undefined) {
      this._name = `${this._type}_${interval}${kindSuffix[kind]}`
    } else {
      this._name = name
    }

    this.inProgressBar = {} as any
    this._reset()
  }

  public hasNewSample(timestamp: Date): boolean {
    // privided timestamp is an exchange trade timestamp in that case
    // we bucket based on exchange timestamps when bucketing by time not by localTimestamp
    if (this.inProgressBar.trades === 0) {
      return false
    }

    if (this._kind === 'time') {
      const currentTimestampTimeBucket = this._getTimeBucket(timestamp)
      const openTimestampTimeBucket = this._getTimeBucket(this.inProgressBar.openTimestamp)
      if (currentTimestampTimeBucket > openTimestampTimeBucket) {
        // set the timestamp to the end of the period of given bucket
        this.inProgressBar.timestamp = new Date((openTimestampTimeBucket + 1) * this._interval)

        return true
      }

      return false
    }

    if (this._kind === 'volume') {
      return this.inProgressBar.volume >= this._interval
    }

    if (this._kind === 'tick') {
      return this.inProgressBar.trades >= this._interval
    }

    return false
  }

  public getSample(localTimestamp: Date) {
    this.inProgressBar.localTimestamp = localTimestamp

    const sample: TradeBar = { ...this.inProgressBar }
    this._reset()

    return sample
  }

  public update(trade: Trade) {
    const inProgressBar = this.inProgressBar
    const isNotOpenedYet = inProgressBar.trades === 0

    if (isNotOpenedYet) {
      inProgressBar.symbol = trade.symbol
      inProgressBar.exchange = trade.exchange
      inProgressBar.open = trade.price
      inProgressBar.openTimestamp = trade.timestamp
    }

    if (inProgressBar.high < trade.price) {
      inProgressBar.high = trade.price
    }
    if (inProgressBar.low > trade.price) {
      inProgressBar.low = trade.price
    }

    inProgressBar.close = trade.price
    inProgressBar.closeTimestamp = trade.timestamp

    inProgressBar.buyVolume += trade.side === 'buy' ? trade.amount : 0
    inProgressBar.sellVolume += trade.side === 'sell' ? trade.amount : 0
    inProgressBar.trades += 1
    inProgressBar.vwap = (inProgressBar.vwap * inProgressBar.volume + trade.price * trade.amount) / (inProgressBar.volume + trade.amount)
    // volume needs to be updated after vwap otherwise vwap calc will go wrong
    inProgressBar.volume += trade.amount
    inProgressBar.timestamp = trade.timestamp
  }

  private _reset() {
    const barToReset = this.inProgressBar
    barToReset.type = this._type
    barToReset.symbol = ''
    barToReset.name = this._name
    barToReset.interval = this._interval
    barToReset.kind = this._kind

    barToReset.open = 0
    barToReset.high = Number.MIN_SAFE_INTEGER
    barToReset.low = Number.MAX_SAFE_INTEGER
    barToReset.close = 0

    barToReset.volume = 0
    barToReset.buyVolume = 0
    barToReset.sellVolume = 0

    barToReset.trades = 0
    barToReset.vwap = 0
    barToReset.openTimestamp = DATE_MIN
    barToReset.closeTimestamp = DATE_MIN
    barToReset.localTimestamp = DATE_MIN
    barToReset.timestamp = DATE_MIN
  }

  private _getTimeBucket(timestamp: Date) {
    return Math.floor(timestamp.valueOf() / this._interval)
  }
}

type Writeable<T> = { -readonly [P in keyof T]: T[P] }
