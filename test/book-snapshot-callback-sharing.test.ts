import { describe, test } from 'node:test'
import { compute, computeBookSnapshots } from '../dist/index.js'
import type { BookChange, BookSnapshot } from '../dist/index.js'
import { assert } from './assertions.ts'

describe('book snapshot callback sharing', () => {
  test('shares one order book and invokes the same crossed-level callback once', async () => {
    const messages = async function* (): AsyncIterableIterator<BookChange> {
      yield {
        type: 'book_change',
        exchange: 'bitmex',
        isSnapshot: true,
        asks: [{ price: 101, amount: 2 }],
        bids: [{ price: 100, amount: 1 }],
        localTimestamp: new Date('2019-08-01T00:00:00.000Z'),
        timestamp: new Date('2019-08-01T00:00:00.000Z'),
        symbol: 'XBTUSD'
      }
      yield {
        type: 'book_change',
        exchange: 'bitmex',
        isSnapshot: false,
        asks: [],
        bids: [{ price: 102, amount: 3 }],
        localTimestamp: new Date('2019-08-01T00:00:01.000Z'),
        timestamp: new Date('2019-08-01T00:00:01.000Z'),
        symbol: 'XBTUSD'
      }
    }
    let removedLevels = 0
    const onCrossedLevelRemoved = () => removedLevels++
    const computed = compute(
      messages(),
      computeBookSnapshots({
        depth: 1,
        interval: 0,
        name: 'depth_1',
        removeCrossedLevels: true,
        onCrossedLevelRemoved
      }),
      computeBookSnapshots({
        depth: 25,
        interval: 0,
        name: 'depth_25',
        removeCrossedLevels: true,
        onCrossedLevelRemoved
      })
    )
    const snapshots: BookSnapshot[] = []

    for await (const message of computed) {
      if (message.type === 'book_snapshot') {
        snapshots.push(message)
      }
    }

    assert.equal(removedLevels, 1)
    assert.equal(snapshots.filter((snapshot) => snapshot.name === 'depth_1').length, 2)
    assert.equal(snapshots.filter((snapshot) => snapshot.name === 'depth_25').length, 2)
    assert.equal(snapshots.at(-1)?.asks[0]?.price, undefined)
  })
})
