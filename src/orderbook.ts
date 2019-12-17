import { RBTree } from 'bintrees'
import { BookChange, BookPriceLevel, Writeable } from './types'

export class OrderBook {
  private readonly _bids = new RBTree<BookPriceLevel>((nodeA, nodeB) => nodeB.price - nodeA.price)
  private readonly _asks = new RBTree<BookPriceLevel>((nodeA, nodeB) => nodeA.price - nodeB.price)

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
    const iterator = this._bids.iterator()
    let level = iterator.next()

    while (level !== null) {
      yield level
      level = iterator.next()
    }
  }

  public *asks(): IterableIterator<BookPriceLevel> {
    const iterator = this._asks.iterator()
    let level = iterator.next()

    while (level !== null) {
      yield level
      level = iterator.next()
    }
  }
}

function applyPriceLevelChanges(tree: RBTree<BookPriceLevel>, priceLevelChanges: BookPriceLevel[]) {
  for (const priceLevel of priceLevelChanges) {
    const node = tree.find(priceLevel) as Writeable<BookPriceLevel>
    const nodeExists = node !== null
    const levelShouldBeRemoved = priceLevel.amount === 0

    if (nodeExists && levelShouldBeRemoved) {
      tree.remove(priceLevel)
    } else if (nodeExists) {
      node.amount = priceLevel.amount
    } else if (levelShouldBeRemoved === false) {
      tree.insert({ ...priceLevel })
    }
  }
}
