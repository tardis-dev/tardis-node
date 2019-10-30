import { OrderBook } from '../orderbook'
import { BookChange, BookPriceLevel, BookSnapshot } from '../types'
import { Computable } from './computable'

type BookSnapshotComputableOptions = { name?: string; depth: number; interval: number }

export const computeBookSnapshots = (options: BookSnapshotComputableOptions) => () => new BookSnapshotComputable(options)

const emptyBookLevel = {
  price: 0,
  amount: 0
}

const levelsChanged = (level1: BookPriceLevel, level2: BookPriceLevel) => {
  if (level1.amount !== level2.amount) {
    return true
  }

  if (level1.price !== level2.price) {
    return true
  }

  return false
}

class BookSnapshotComputable implements Computable<BookSnapshot> {
  public readonly sourceDataTypes = ['book_change']
  private _bookChanged = false

  private readonly _type = 'book_snapshot'
  private readonly _orderBook = new OrderBook()
  private readonly _depth: number
  private readonly _interval: number
  private readonly _name: string

  private _updatesCount: number = 0
  private _lastUpdateTimestamp: Date = new Date(-1)
  private _bids: BookPriceLevel[] = []
  private _asks: BookPriceLevel[] = []

  constructor({ depth, name, interval }: BookSnapshotComputableOptions) {
    this._depth = depth
    this._interval = interval

    // initialize all bids/asks levels to empty ones
    for (let i = 0; i < this._depth; i++) {
      this._bids[i] = emptyBookLevel
      this._asks[i] = emptyBookLevel
    }

    if (name === undefined) {
      this._name = `${this._type}_${depth}_${interval}ms`
    } else {
      this._name = name
    }
  }

  public *compute(bookChange: BookChange) {
    if (this._hasNewSnapshot(bookChange.timestamp)) {
      yield this._getSnapshot(bookChange)
    }

    this._update(bookChange)

    // check again after the update as book snapshot with interval set to 0 (real-time) could have changed
    if (this._hasNewSnapshot(bookChange.timestamp)) {
      yield this._getSnapshot(bookChange)
    }
  }

  public _hasNewSnapshot(timestamp: Date): boolean {
    if (this._bookChanged === false) {
      return false
    }

    // report new snapshot anytime book changed
    if (this._interval === 0) {
      return true
    }

    const currentTimestampTimeBucket = this._getTimeBucket(timestamp)
    const snapshotTimestampBucket = this._getTimeBucket(this._lastUpdateTimestamp)

    if (currentTimestampTimeBucket > snapshotTimestampBucket) {
      // set  timestamp to end of snapshot 'interval' period
      this._lastUpdateTimestamp = new Date((snapshotTimestampBucket + 1) * this._interval)

      return true
    }

    return false
  }

  public _update(bookChange: BookChange) {
    this._orderBook.update(bookChange)
    this._updatesCount++

    const bidsIterable = this._orderBook.bids()
    const asksIterable = this._orderBook.asks()

    for (let i = 0; i < this._depth; i++) {
      const bidLevelResult = bidsIterable.next()
      const newBid = bidLevelResult.done ? emptyBookLevel : bidLevelResult.value

      if (this._bookChanged === false && levelsChanged(this._bids[i], newBid)) {
        this._bookChanged = true
      }

      this._bids[i] = newBid

      const askLevelResult = asksIterable.next()
      const newAsk = askLevelResult.done ? emptyBookLevel : askLevelResult.value

      if (this._bookChanged === false && levelsChanged(this._asks[i], newAsk)) {
        this._bookChanged = true
      }

      this._asks[i] = newAsk
    }

    this._lastUpdateTimestamp = bookChange.timestamp
  }

  public _getSnapshot(bookChange: BookChange) {
    const snapshot: BookSnapshot = {
      type: this._type as any,
      symbol: bookChange.symbol,
      exchange: bookChange.exchange,
      name: this._name,
      depth: this._depth,
      interval: this._interval,
      updatesCount: this._updatesCount,
      bids: [...this._bids],
      asks: [...this._asks],
      timestamp: this._lastUpdateTimestamp,
      localTimestamp: bookChange.localTimestamp
    }

    this._bookChanged = false
    this._updatesCount = 0

    return snapshot
  }

  private _getTimeBucket(timestamp: Date) {
    return Math.floor(timestamp.valueOf() / this._interval)
  }
}
