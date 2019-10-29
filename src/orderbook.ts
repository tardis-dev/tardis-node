import BTree from 'sorted-btree'
import { BookPriceLevel, BookChange } from './types'

export class OrderBook {
  private readonly _bids = new BTree<BookPriceLevel, undefined>(
    undefined,
    (a, b) => {
      return b.price - a.price
    },
    64
  )

  private readonly _asks = new BTree<BookPriceLevel, undefined>(
    undefined,
    (a, b) => {
      return a.price - b.price
    },
    64
  )

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
    const result = this.bids().next()

    if (result.done === false) {
      return result.value
    }
    return undefined
  }

  public bestAsk() {
    const result = this.asks().next()

    if (result.done === false) {
      return result.value
    }
    return undefined
  }

  public bids(): IterableIterator<BookPriceLevel> {
    return this._bids.keys()
  }

  public asks(): IterableIterator<BookPriceLevel> {
    return this._asks.keys()
  }
}

function applyPriceLevelChanges(levels: BTree<BookPriceLevel, undefined>, priceLevelChanges: BookPriceLevel[]) {
  for (const priceLevel of priceLevelChanges) {
    const priceLevelToApply = { ...priceLevel }
    const levelNeedsToBeDeleted = priceLevelToApply.amount === 0

    if (levelNeedsToBeDeleted) {
      levels.delete(priceLevelToApply)
    } else {
      levels.set(priceLevelToApply, undefined)
    }
  }
}
