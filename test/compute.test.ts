import { describe, test } from 'node:test'
import { assert, snapshot } from './assertions.ts'
import { compute, computeBookSnapshots, computeTradeBars } from '../dist/index.js'
import type { BookChange, Trade } from '../dist/index.js'

const createBookChange = (bids: BookChange['bids'], asks: BookChange['asks'], isSnapshot = false): BookChange => ({
  type: 'book_change',
  exchange: 'bitmex',
  isSnapshot,
  asks,
  bids,
  localTimestamp: new Date('2019-08-01T00:00:00.132Z'),
  timestamp: new Date('2019-08-01T00:00:00.132Z'),
  symbol: 'XBTUSD'
})

describe('compute(messages, types)', () => {
  test('should compute correct trade bars based on provided messages', async () => {
    let tradesMessages = async function* (): AsyncIterableIterator<Trade> {
      yield {
        type: 'trade',
        exchange: 'bitmex',
        amount: 200,
        symbol: 'XBTUSD',
        id: 'asd',
        price: 1000,
        side: 'buy',
        timestamp: new Date('2019-08-01T00:00:00.132Z'),
        localTimestamp: new Date('2019-08-01T00:00:00.132Z')
      }

      yield {
        type: 'trade',
        exchange: 'bitmex',
        amount: 2000,
        symbol: 'XBTUSD',
        id: 'sadasd',
        price: 1000,
        side: 'buy',
        timestamp: new Date('2019-08-01T00:01:00.000Z'),
        localTimestamp: new Date('2019-08-01T00:01:00.132Z')
      }

      yield {
        type: 'trade',
        exchange: 'bitmex',
        amount: 200,
        symbol: 'XBTUSD',
        id: 'asdssd',
        price: 1005,
        side: 'sell',
        timestamp: new Date('2019-08-01T00:01:01.000Z'),
        localTimestamp: new Date('2019-08-01T00:01:01.132Z')
      }

      yield {
        type: 'trade',
        exchange: 'bitmex',
        amount: 2000,
        symbol: 'XBTUSD',
        id: 'asddfssd',
        price: 1015,
        side: 'buy',
        timestamp: new Date('2019-08-01T00:01:02.000Z'),
        localTimestamp: new Date('2019-08-01T00:01:02.132Z')
      }

      yield {
        type: 'trade',
        exchange: 'bitmex',
        amount: 200,
        symbol: 'XBTUSD',
        id: 'sdfc',
        price: 1013,
        side: 'buy',
        timestamp: new Date('2019-08-01T00:04:00.120Z'),
        localTimestamp: new Date('2019-08-01T00:04:01.132Z')
      }

      yield {
        type: 'trade',
        exchange: 'bitmex',
        amount: 2000,
        symbol: 'XBTUSD',
        id: 'sdfsdfc',
        price: 1010,
        side: 'sell',
        timestamp: new Date('2019-08-01T00:06:00.100Z'),
        localTimestamp: new Date('2019-08-01T00:06:01.132Z')
      }
    }

    const withComputedTypes = compute(
      tradesMessages(),
      computeTradeBars({ kind: 'time', interval: 60 * 1000, name: 'trade_bar_1_minute' }),
      computeTradeBars({ kind: 'tick', interval: 2, name: 'trade_bar_2ticks' }),
      computeTradeBars({ kind: 'volume', interval: 2000, name: 'trade_bar_2kvol' })
    )
    const bufferedMessages = []

    for await (const message of withComputedTypes) {
      bufferedMessages.push(message)
    }

    snapshot(bufferedMessages)
  })

  test('should produce correct book snapshots based on provided messages', async () => {
    let messages = async function* (): AsyncIterableIterator<Trade | BookChange> {
      yield {
        type: 'trade',
        exchange: 'bitmex',
        amount: 200,
        symbol: 'XBTUSD',
        id: 'asd',
        price: 1000,
        side: 'buy',
        timestamp: new Date('2019-08-01T00:00:00.132Z'),
        localTimestamp: new Date('2019-08-01T00:00:00.132Z')
      }

      yield {
        type: 'book_change',
        exchange: 'bitmex',
        isSnapshot: true,
        asks: [
          { price: 200, amount: 20 },
          { price: 120, amount: 1 }
        ],
        bids: [{ price: 119, amount: 20 }],
        localTimestamp: new Date('2019-08-01T00:00:00.132Z'),
        timestamp: new Date('2019-08-01T00:00:00.132Z'),
        symbol: 'XBTUSD'
      }

      yield {
        type: 'book_change',
        exchange: 'bitmex',
        isSnapshot: false,
        asks: [{ price: 120, amount: 10 }],
        bids: [],
        localTimestamp: new Date('2019-08-01T00:00:10.132Z'),
        timestamp: new Date('2019-08-01T00:00:10.132Z'),
        symbol: 'XBTUSD'
      }

      yield {
        type: 'book_change',
        exchange: 'bitmex',
        isSnapshot: false,
        asks: [{ price: 201, amount: 10 }],
        bids: [],
        localTimestamp: new Date('2019-08-01T00:00:12.132Z'),
        timestamp: new Date('2019-08-01T00:00:12.132Z'),
        symbol: 'XBTUSD'
      }

      yield {
        type: 'book_change',
        exchange: 'bitmex',
        isSnapshot: false,
        asks: [{ price: 200, amount: 220 }],
        bids: [],
        localTimestamp: new Date('2019-08-01T00:00:12.132Z'),
        timestamp: new Date('2019-08-01T00:00:12.132Z'),
        symbol: 'XBTUSD'
      }

      yield {
        type: 'book_change',
        exchange: 'bitmex',
        isSnapshot: false,
        asks: [],
        bids: [{ price: 120, amount: 20 }],
        localTimestamp: new Date('2019-08-01T00:00:13.132Z'),
        timestamp: new Date('2019-08-01T00:00:13.132Z'),
        symbol: 'XBTUSD'
      }
    }

    const withComputedTypes = compute(
      messages(),
      computeBookSnapshots({ depth: 2, interval: 1000 }),
      computeBookSnapshots({ depth: 1, interval: 0, name: 'quotes' })
    )

    const bufferedMessages = []

    for await (const message of withComputedTypes) {
      bufferedMessages.push(message)
    }

    snapshot(bufferedMessages)
  })

  test('keeps price levels isolated between shared book snapshot computables', async () => {
    const messages = async function* (): AsyncIterableIterator<BookChange> {
      yield {
        type: 'book_change',
        exchange: 'bitmex',
        isSnapshot: true,
        asks: [{ price: 101, amount: 2 }],
        bids: [{ price: 100, amount: 1 }],
        localTimestamp: new Date('2019-08-01T00:00:00.132Z'),
        timestamp: new Date('2019-08-01T00:00:00.132Z'),
        symbol: 'XBTUSD'
      }
    }

    const computed = compute(
      messages(),
      computeBookSnapshots({ depth: 1, interval: 0, name: 'depth_1' }),
      computeBookSnapshots({ depth: 2, interval: 0, name: 'depth_2' })
    )
    let depth1BestBid: object | undefined

    for await (const message of computed) {
      if (message.type !== 'book_snapshot') continue

      if (message.name === 'depth_1') {
        depth1BestBid = message.bids[0]
        ;(depth1BestBid as any).amount = 999
      } else {
        assert.notStrictEqual(message.bids[0], depth1BestBid)
        assert.strictEqual(message.bids[0].amount, 1)
      }
    }
  })

  test('does not expose internal context to custom computable factories', async () => {
    let factoryArgumentsCount = -1
    const customFactory = function () {
      factoryArgumentsCount = arguments.length
      return {
        sourceDataTypes: [],
        *compute() {}
      }
    }
    const messages = async function* (): AsyncIterableIterator<BookChange> {
      yield createBookChange([], [], true)
    }

    for await (const _ of compute(messages(), customFactory)) {
    }

    assert.strictEqual(factoryArgumentsCount, 0)
  })

  test('keeps grouped snapshots correct across outside, boundary, and refill changes', async () => {
    const messages = async function* (): AsyncIterableIterator<BookChange> {
      yield createBookChange(
        [
          { price: 10.9, amount: 1 },
          { price: 10.4, amount: 2 },
          { price: 9.9, amount: 3 }
        ],
        [
          { price: 11.1, amount: 4 },
          { price: 11.6, amount: 5 },
          { price: 12.1, amount: 6 }
        ],
        true
      )
      yield createBookChange([{ price: 9.9, amount: 4 }], [{ price: 12.1, amount: 7 }])
      yield createBookChange([{ price: 10.4, amount: 8 }], [{ price: 11.6, amount: 9 }])
      yield createBookChange([{ price: 10.4, amount: 0 }], [{ price: 11.6, amount: 0 }])
      yield createBookChange([{ price: 9.9, amount: 0 }], [{ price: 12.1, amount: 0 }])
      yield createBookChange([{ price: 9.4, amount: 10 }], [{ price: 12.6, amount: 11 }])
    }

    const computed = compute(
      messages(),
      computeBookSnapshots({ depth: 2, grouping: 0.5, interval: 0, name: 'top_2' }),
      computeBookSnapshots({ depth: 4, grouping: 0.5, interval: 0, name: 'full_depth' })
    )
    const snapshots = []
    for await (const message of computed) {
      if (message.type === 'book_snapshot') snapshots.push(message)
    }

    const top2 = snapshots.filter((snapshot) => snapshot.name === 'top_2')
    const fullDepth = snapshots.filter((snapshot) => snapshot.name === 'full_depth')
    const fullTop2 = top2.filter((snapshot) => snapshot.bids[1].price !== undefined && snapshot.asks[1].price !== undefined)
    assert.deepStrictEqual(
      fullTop2.map((snapshot) => snapshot.bids[1]),
      [
        { price: 10, amount: 2 },
        { price: 10, amount: 8 },
        { price: 9.5, amount: 4 },
        { price: 9, amount: 10 }
      ]
    )
    assert.deepStrictEqual(
      fullTop2.map((snapshot) => snapshot.asks[1]),
      [
        { price: 12, amount: 5 },
        { price: 12, amount: 9 },
        { price: 12.5, amount: 7 },
        { price: 13, amount: 11 }
      ]
    )
    assert.deepStrictEqual(fullDepth[1].bids.slice(1, 3), [
      { price: 10, amount: 2 },
      { price: 9.5, amount: 4 }
    ])
    assert.deepStrictEqual(fullDepth[1].asks.slice(1, 3), [
      { price: 12, amount: 5 },
      { price: 12.5, amount: 7 }
    ])
  })

  test('clears grouped levels when a book side shrinks', async () => {
    const messages = async function* (): AsyncIterableIterator<BookChange> {
      yield createBookChange(
        [
          { price: 100.9, amount: 1 },
          { price: 99.9, amount: 2 },
          { price: 98.9, amount: 3 }
        ],
        [
          { price: 101.1, amount: 4 },
          { price: 102.1, amount: 5 },
          { price: 103.1, amount: 6 }
        ],
        true
      )
      yield createBookChange(
        [
          { price: 99.9, amount: 0 },
          { price: 98.9, amount: 0 }
        ],
        [
          { price: 102.1, amount: 0 },
          { price: 103.1, amount: 0 }
        ]
      )
      yield createBookChange([{ price: 100.9, amount: 0 }], [{ price: 101.1, amount: 0 }])
    }

    const snapshots = []
    const computed = compute(messages(), computeBookSnapshots({ depth: 3, grouping: 1, interval: 0 }))
    for await (const message of computed) {
      if (message.type === 'book_snapshot') snapshots.push(message)
    }

    const emptyLevel = { price: undefined, amount: undefined }
    assert.deepStrictEqual(
      snapshots.map(({ bids, asks }) => ({ bids, asks })),
      [
        {
          bids: [
            { price: 100, amount: 1 },
            { price: 99, amount: 2 },
            { price: 98, amount: 3 }
          ],
          asks: [
            { price: 102, amount: 4 },
            { price: 103, amount: 5 },
            { price: 104, amount: 6 }
          ]
        },
        {
          bids: [{ price: 100, amount: 1 }, emptyLevel, emptyLevel],
          asks: [{ price: 102, amount: 4 }, emptyLevel, emptyLevel]
        },
        {
          bids: [emptyLevel, emptyLevel, emptyLevel],
          asks: [emptyLevel, emptyLevel, emptyLevel]
        }
      ]
    )
  })

  test('rebuilds both grouped sides when crossed levels are removed', async () => {
    const messages = async function* (): AsyncIterableIterator<BookChange> {
      yield createBookChange(
        [
          { price: 100, amount: 1 },
          { price: 90, amount: 2 }
        ],
        [
          { price: 110, amount: 3 },
          { price: 120, amount: 4 }
        ],
        true
      )
      yield createBookChange([], [{ price: 95, amount: 5 }])
      yield createBookChange([{ price: 115, amount: 6 }], [])
    }

    const snapshots = []
    const computed = compute(messages(), computeBookSnapshots({ depth: 1, grouping: 10, interval: 0, removeCrossedLevels: true }))
    for await (const message of computed) {
      if (message.type === 'book_snapshot') snapshots.push(message)
    }

    assert.deepStrictEqual(
      snapshots.map(({ bids, asks }) => ({ bids, asks })),
      [
        { bids: [{ price: 100, amount: 1 }], asks: [{ price: 110, amount: 3 }] },
        { bids: [{ price: 90, amount: 2 }], asks: [{ price: 100, amount: 5 }] },
        { bids: [{ price: 110, amount: 6 }], asks: [{ price: 120, amount: 4 }] }
      ]
    )
  })

  test('computes time bars from out-of-order trade timestamps', async () => {
    const messages = async function* (): AsyncIterableIterator<Trade> {
      yield {
        id: undefined,
        type: 'trade',
        symbol: 'CRV-USD',
        exchange: 'dydx',
        price: 0.3394,
        amount: 1273,
        side: 'buy',
        timestamp: new Date('2024-06-23T03:05:59.988Z'),
        localTimestamp: new Date('2024-06-23T03:06:00.158521Z')
      }
      yield {
        id: undefined,
        type: 'trade',
        symbol: 'CRV-USD',
        exchange: 'dydx',
        price: 0.3387,
        amount: 65,
        side: 'buy',
        timestamp: new Date('2024-06-23T03:05:59.981Z'),
        localTimestamp: new Date('2024-06-23T03:06:00.173614Z')
      }
      yield {
        id: undefined,
        type: 'trade',
        symbol: 'CRV-USD',
        exchange: 'dydx',
        price: 0.3387,
        amount: 65,
        side: 'buy',
        timestamp: new Date('2024-06-23T03:06:01.981Z'),
        localTimestamp: new Date('2024-06-23T03:06:02.173614Z')
      }
    }

    const withComputedTypes = compute(messages(), computeTradeBars({ kind: 'time', interval: 60 * 1000, name: 'trade_bar_1_minute' }))

    const bufferedMessages = []

    for await (const message of withComputedTypes) {
      bufferedMessages.push(message)
    }

    snapshot(bufferedMessages)
  })
})
