import SortedSet from 'collections/sorted-set'
import { BookPriceLevel, BookChange } from './types'

const isBookLevelEqual = (first: BookPriceLevel, second: BookPriceLevel) => first.price === second.price

export class OrderBook {
  private readonly _bids = new SortedSet<BookPriceLevel>([], isBookLevelEqual, (first, second) => second.price - first.price)
  private readonly _asks = new SortedSet<BookPriceLevel>([], isBookLevelEqual, (first, second) => first.price - second.price)
  private _receivedInitialSnapshot = false

  public update(bookChange: BookChange) {
    // clear everything up, when snapshot received so we don't have stale levels by accident
    if (bookChange.isSnapshot) {
      this._bids.clear()
      this._asks.clear()
      this._receivedInitialSnapshot = true
    }
    // process updates as long as we've received initial snapshot, otherwise ignore such messages
    if (this._receivedInitialSnapshot) {
      applyPriceLevelChanges(this._asks, bookChange.asks)
      applyPriceLevelChanges(this._bids, bookChange.bids)
    }
  }

  public bestBid() {
    return findNearestLevel(this._bids)
  }

  public bestAsk() {
    return findNearestLevel(this._asks)
  }

  public bids() {
    return new LevelsIterableIterator(this._bids)
  }

  public asks(): Iterable<BookPriceLevel> {
    return new LevelsIterableIterator(this._asks)
  }
}

function findNearestLevel(levels: SortedSet<BookPriceLevel>): BookPriceLevel | undefined {
  const node = levels.findLeast()
  if (node) {
    return (node as any).value
  }
  return
}

function applyPriceLevelChanges(levels: SortedSet<BookPriceLevel>, priceLevelChanges: BookPriceLevel[]) {
  for (const priceLevel of priceLevelChanges) {
    const priceLevelToApply = { ...priceLevel }
    const node = levels.findValue(priceLevelToApply)
    const levelNeedsToBeRemoved = priceLevelToApply.amount === 0

    if (node && levelNeedsToBeRemoved) {
      levels.delete(priceLevelToApply)
    } else if (node) {
      node.value = priceLevelToApply
    } else {
      levels.add(priceLevelToApply)
    }
  }
}

class LevelsIterableIterator implements IterableIterator<BookPriceLevel> {
  private readonly _levels: SortedSet<BookPriceLevel>
  private _previousLevel?: BookPriceLevel
  constructor(levels: SortedSet<BookPriceLevel>) {
    this._levels = levels
  }

  public next(): IteratorResult<BookPriceLevel> {
    let next
    if (this._previousLevel) {
      next = this._levels.findLeastGreaterThan(this._previousLevel)
    } else {
      next = this._levels.findLeast()
    }

    if (!next) {
      return {
        done: true,
        value: undefined
      }
    } else {
      const value = (next as any).value
      this._previousLevel = value
      return {
        done: false,
        value
      }
    }
  }

  [Symbol.iterator](): IterableIterator<BookPriceLevel> {
    return this
  }
}
