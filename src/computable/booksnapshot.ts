import { decimalPlaces } from '../handy.ts'
import { OrderBook, OnLevelRemovedCB } from '../orderbook.ts'
import { BookChange, BookPriceLevel, BookSnapshot, Optional } from '../types.ts'
import { Computable } from './computable.ts'
import { ComputableContext, registerContextualFactory } from './context.ts'

type BookSnapshotComputableOptions = {
  name?: string
  depth: number
  grouping?: number
  interval: number
  removeCrossedLevels?: boolean
  onCrossedLevelRemoved?: OnLevelRemovedCB
}

export const computeBookSnapshots = (options: BookSnapshotComputableOptions): (() => Computable<BookSnapshot>) => {
  const factory = () => new BookSnapshotComputable(options)
  registerContextualFactory(factory, (context) => new BookSnapshotComputable(options, context))
  return factory
}

type OrderBookHandle = {
  orderBook: OrderBook
  isOwner: boolean
}

const sharedOrderBooksKey = Symbol('bookSnapshotOrderBooks')

const emptyBookLevel = {
  price: undefined,
  amount: undefined
}

const levelsChanged = (level1: Optional<BookPriceLevel>, level2: Optional<BookPriceLevel>) => {
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
  private _initialized = false

  private readonly _type = 'book_snapshot'
  private readonly _orderBook: OrderBook
  private readonly _ownsOrderBook: boolean
  private readonly _depth: number
  private readonly _interval: number
  private readonly _name: string
  private readonly _grouping: number | undefined
  private readonly _groupingDecimalPlaces: number | undefined
  private readonly _removeCrossedLevels: boolean

  private _lastUpdateTimestamp: Date = new Date(-1)
  private _bids: Optional<BookPriceLevel>[] = []
  private _asks: Optional<BookPriceLevel>[] = []
  private _groupedBidBoundary: number | undefined
  private _groupedAskBoundary: number | undefined

  constructor(
    { depth, name, interval, removeCrossedLevels, grouping, onCrossedLevelRemoved }: BookSnapshotComputableOptions,
    context?: ComputableContext
  ) {
    this._depth = depth
    this._interval = interval
    this._grouping = grouping
    this._groupingDecimalPlaces = this._grouping ? decimalPlaces(this._grouping) : undefined
    this._removeCrossedLevels = Boolean(removeCrossedLevels)

    const orderBookHandle = getOrderBookHandle(context, removeCrossedLevels, onCrossedLevelRemoved)
    this._orderBook = orderBookHandle.orderBook
    this._ownsOrderBook = orderBookHandle.isOwner

    // initialize all bids/asks levels to empty ones
    for (let i = 0; i < this._depth; i++) {
      this._bids[i] = emptyBookLevel
      this._asks[i] = emptyBookLevel
    }

    if (name === undefined) {
      this._name = `${this._type}_${depth}${this._grouping ? `_grouped${this._grouping}` : ''}_${interval}ms`
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
    // or it's initial snapshot
    if (this._hasNewSnapshot(bookChange.timestamp)) {
      yield this._getSnapshot(bookChange)

      if (this._initialized === false) {
        this._initialized = true
      }
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

    // report new snapshot for book snapshots with interval for initial snapshot
    if (this._initialized === false) {
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
    if (this._ownsOrderBook) {
      this._orderBook.update(bookChange)
    }

    if (this._grouping !== undefined) {
      const updateBothGroupedSides = bookChange.isSnapshot || this._removeCrossedLevels
      if (updateBothGroupedSides || this._groupedSideMayHaveChanged(bookChange.bids, this._groupedBidBoundary, false)) {
        this._groupedBidBoundary = this._updateSideGrouped(this._orderBook.bids(), this._bids, false)
      }
      if (updateBothGroupedSides || this._groupedSideMayHaveChanged(bookChange.asks, this._groupedAskBoundary, true)) {
        this._groupedAskBoundary = this._updateSideGrouped(this._orderBook.asks(), this._asks, true)
      }
    } else {
      this._updatedNotGrouped()
    }

    this._lastUpdateTimestamp = bookChange.timestamp
  }

  private _groupedSideMayHaveChanged(changes: BookPriceLevel[], boundary: number | undefined, roundUp: boolean) {
    if (changes.length === 0) return false
    if (boundary === undefined) return true

    for (const level of changes) {
      const groupedPrice = this._getGroupedPrice(level.price, roundUp)
      if (roundUp ? groupedPrice <= boundary : groupedPrice >= boundary) {
        return true
      }
    }

    return false
  }

  private _updatedNotGrouped() {
    const bidsIterable = this._orderBook.bids()
    const asksIterable = this._orderBook.asks()

    for (let i = 0; i < this._depth; i++) {
      const bidLevelResult = bidsIterable.next()
      const newBid = bidLevelResult.done ? emptyBookLevel : bidLevelResult.value

      if (levelsChanged(this._bids[i], newBid)) {
        this._bids[i] = { price: newBid.price, amount: newBid.amount }
        this._bookChanged = true
      }

      const askLevelResult = asksIterable.next()
      const newAsk = askLevelResult.done ? emptyBookLevel : askLevelResult.value

      if (levelsChanged(this._asks[i], newAsk)) {
        this._asks[i] = { price: newAsk.price, amount: newAsk.amount }
        this._bookChanged = true
      }
    }
  }

  private _getGroupedPrice(price: number, roundUp: boolean) {
    if (this._groupingDecimalPlaces === 0) {
      const remainder = price % this._grouping!
      return price - remainder + (roundUp && remainder > 0 ? this._grouping! : 0)
    }

    const pow = Math.pow(10, this._groupingDecimalPlaces!)
    const pricePow = price * pow
    const groupPow = this._grouping! * pow
    const remainder = (pricePow % groupPow) / pow

    return (pricePow - remainder * pow + (roundUp && remainder > 0 ? groupPow : 0)) / pow
  }

  private _updateSideGrouped(
    newLevels: IterableIterator<BookPriceLevel>,
    existingGroupedLevels: Optional<BookPriceLevel>[],
    roundUp: boolean
  ) {
    let currentGroupedPrice: number | undefined = undefined
    let aggAmount = 0
    let currentDepth = 0

    for (const notGroupedLevel of newLevels) {
      const groupedPrice = this._getGroupedPrice(notGroupedLevel.price, roundUp)

      if (currentGroupedPrice == undefined) {
        currentGroupedPrice = groupedPrice
      }

      if (currentGroupedPrice != groupedPrice) {
        const existingGroupedLevel = existingGroupedLevels[currentDepth]
        if (existingGroupedLevel.amount !== aggAmount || existingGroupedLevel.price !== currentGroupedPrice) {
          existingGroupedLevels[currentDepth] = {
            price: currentGroupedPrice,
            amount: aggAmount
          }
          this._bookChanged = true
        }

        currentDepth++

        if (currentDepth === this._depth) {
          return currentGroupedPrice
        }

        currentGroupedPrice = groupedPrice
        aggAmount = 0
      }

      aggAmount += notGroupedLevel.amount
    }

    if (currentDepth < this._depth && aggAmount > 0) {
      const existingGroupedLevel = existingGroupedLevels[currentDepth]
      if (existingGroupedLevel.amount !== aggAmount || existingGroupedLevel.price !== currentGroupedPrice) {
        existingGroupedLevels[currentDepth] = {
          price: currentGroupedPrice,
          amount: aggAmount
        }
        this._bookChanged = true
      }
      currentDepth++
    }

    return currentDepth === this._depth ? currentGroupedPrice : undefined
  }

  public _getSnapshot(bookChange: BookChange) {
    const snapshot: BookSnapshot = {
      type: this._type as any,
      symbol: bookChange.symbol,
      exchange: bookChange.exchange,
      name: this._name,
      depth: this._depth,
      interval: this._interval,
      grouping: this._grouping,
      bids: [...this._bids],
      asks: [...this._asks],
      timestamp: this._lastUpdateTimestamp,
      localTimestamp: bookChange.localTimestamp
    }

    this._bookChanged = false

    return snapshot
  }

  private _getTimeBucket(timestamp: Date) {
    return Math.floor(timestamp.valueOf() / this._interval)
  }
}

function getOrderBookHandle(
  context: ComputableContext | undefined,
  removeCrossedLevels: boolean | undefined,
  onCrossedLevelRemoved: OnLevelRemovedCB | undefined
): OrderBookHandle {
  if (context === undefined || onCrossedLevelRemoved !== undefined) {
    return {
      orderBook: new OrderBook({ removeCrossedLevels, onCrossedLevelRemoved }),
      isOwner: true
    }
  }

  let sharedOrderBooks = context.get(sharedOrderBooksKey) as Map<boolean, OrderBook> | undefined
  if (sharedOrderBooks === undefined) {
    sharedOrderBooks = new Map()
    context.set(sharedOrderBooksKey, sharedOrderBooks)
  }

  const key = removeCrossedLevels === true
  const sharedOrderBook = sharedOrderBooks.get(key)
  if (sharedOrderBook !== undefined) {
    return { orderBook: sharedOrderBook, isOwner: false }
  }

  const orderBook = new OrderBook({ removeCrossedLevels })
  sharedOrderBooks.set(key, orderBook)
  return { orderBook, isOwner: true }
}
