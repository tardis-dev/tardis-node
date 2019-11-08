import BTree from 'sorted-btree'
import { BookChange, BookPriceLevel } from './types'

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

  public *bids(): IterableIterator<BookPriceLevel> {
    for (const level of this._bids.keys()) {
      // skip empty levels
      if (level.amount !== 0) {
        yield level
      }
    }
  }

  public *asks(): IterableIterator<BookPriceLevel> {
    for (const level of this._asks.keys()) {
      // skip empty levels
      if (level.amount !== 0) {
        yield level
      }
    }
  }
}

function applyPriceLevelChanges(levels: BTree<BookPriceLevel, undefined>, priceLevelChanges: BookPriceLevel[]) {
  for (const priceLevel of priceLevelChanges) {
    levels.set({ ...priceLevel }, undefined)
  }
}
