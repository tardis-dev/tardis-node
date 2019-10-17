import { Computable } from './computable'
import { BookSnapshot, BookChange, DataType } from '../types'
import { OrderBook } from '../orderbook'
import { take } from '../handy'

type BookSnapshotComputableOptions = { name?: string; depth: number; interval: number }

export const bookSnapshotComputable = (options: BookSnapshotComputableOptions) => () => new BookSnapshotComputable(options)

class BookSnapshotComputable implements Computable<BookSnapshot> {
  public readonly sourceDataTypes: DataType[] = ['book_change']
  private _bookChanged = false
  private _symbol: string = ''
  private _exchange: string = ''
  private _updatesCount: number = 0
  private _timestamp: Date = new Date(-1)
  private _type = 'book_snapshot'
  private readonly orderBook = new OrderBook()
  private readonly _depth: number
  private readonly _interval: number
  private readonly _name: string

  constructor({ depth, name, interval }: BookSnapshotComputableOptions) {
    this._depth = depth
    this._interval = interval
    if (name === undefined) {
      this._name = `${this._type}_${depth}_${interval}ms`
    } else {
      this._name = name
    }
  }

  public hasNewSample(timestamp: Date): boolean {
    if (this._bookChanged === false) {
      return false
    }

    // report new sample anytime book changed
    if (this._interval === 0) {
      return true
    }

    const currentTimestampTimeBucket = this._getTimeBucket(timestamp)
    const snapshotTimestampBucket = this._getTimeBucket(this._timestamp)

    if (currentTimestampTimeBucket > snapshotTimestampBucket) {
      // set  timestamp to end of snapshot 'interval' period
      this._timestamp = new Date((snapshotTimestampBucket + 1) * this._interval)

      return true
    }

    return false
  }

  public update(bookChange: BookChange) {
    const updateInfo = this.orderBook.update(bookChange)
    this._updatesCount++

    const bidWithinDepthHasChanged =
      updateInfo.lowestUpdatedBidDepthIndex !== undefined && updateInfo.lowestUpdatedBidDepthIndex < this._depth

    const askWithinDepthHasChanged =
      updateInfo.lowestUpdatedAskDepthIndex !== undefined && updateInfo.lowestUpdatedAskDepthIndex < this._depth

    if (bidWithinDepthHasChanged || askWithinDepthHasChanged) {
      this._bookChanged = true
    }

    this._timestamp = bookChange.timestamp

    if (this._symbol === '') {
      this._symbol = bookChange.symbol
    }

    if (this._exchange === '') {
      this._exchange = bookChange.exchange
    }
  }

  public getSample(localTimestamp: Date) {
    const snapshot: BookSnapshot = {
      type: 'book_snapshot',
      symbol: this._symbol,
      exchange: this._exchange as any,
      name: this._name,
      depth: this._depth,
      interval: this._interval,
      updatesCount: this._updatesCount,
      bids: Array.from(take(this.orderBook.bids(), this._depth)),
      asks: Array.from(take(this.orderBook.asks(), this._depth)),
      timestamp: this._timestamp,
      localTimestamp
    }

    this._bookChanged = false
    this._updatesCount = 0

    return snapshot
  }

  private _getTimeBucket(timestamp: Date) {
    return Math.floor(timestamp.valueOf() / this._interval)
  }
}
