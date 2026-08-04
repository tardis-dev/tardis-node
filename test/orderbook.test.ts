import { OrderBook } from '../dist/index.js'

describe('orderbook', () => {
  test('should update levels', () => {
    const orderBook = new OrderBook()
    // update before snapshot
    orderBook.update({
      asks: [
        { price: 200, amount: 20 },
        { price: 120, amount: 1 }
      ],
      bids: [{ price: 119, amount: 20 }],
      exchange: 'binance',
      isSnapshot: false,
      localTimestamp: new Date(),
      timestamp: new Date(),
      symbol: 'BTCUSD',
      type: 'book_change'
    })

    expect(orderBook.bestAsk()).toBeUndefined
    expect(orderBook.bestBid()).toBeUndefined

    // initial snapshot
    orderBook.update({
      asks: [
        { price: 200, amount: 20 },
        { price: 120, amount: 1 }
      ],
      bids: [{ price: 119, amount: 20 }],
      isSnapshot: true,
      localTimestamp: new Date(),
      timestamp: new Date(),
      exchange: 'binance',
      symbol: 'BTCUSD',
      type: 'book_change'
    })

    expect(orderBook.bestAsk()).toEqual({
      price: 120,
      amount: 1
    })
    expect(orderBook.bestBid()).toEqual({
      price: 119,
      amount: 20
    })

    expect(Array.from(orderBook.asks())).toEqual([
      { price: 120, amount: 1 },
      { price: 200, amount: 20 }
    ])
    expect(Array.from(orderBook.bids())).toEqual([{ price: 119, amount: 20 }])

    // bids and asks updates
    orderBook.update({
      asks: [
        { price: 201, amount: 2000 },
        { price: 120, amount: 100 }
      ],
      bids: [
        { price: 118, amount: 200 },
        { price: 119, amount: 201 },
        { price: 119.5, amount: 21 }
      ],
      isSnapshot: false,
      localTimestamp: new Date(),
      timestamp: new Date(),
      exchange: 'binance',
      symbol: 'BTCUSD',
      type: 'book_change'
    })

    expect(orderBook.bestAsk()).toEqual({
      price: 120,
      amount: 100
    })

    expect(orderBook.bestBid()).toEqual({
      price: 119.5,
      amount: 21
    })

    expect(Array.from(orderBook.asks())).toEqual([
      { price: 120, amount: 100 },
      { price: 200, amount: 20 },
      { price: 201, amount: 2000 }
    ])
    expect(Array.from(orderBook.bids())).toEqual([
      { price: 119.5, amount: 21 },
      { price: 119, amount: 201 },
      { price: 118, amount: 200 }
    ])

    // delete levels
    orderBook.update({
      asks: [{ price: 120, amount: 0 }],
      bids: [{ price: 119, amount: 0 }],
      isSnapshot: false,
      localTimestamp: new Date(),
      timestamp: new Date(),
      exchange: 'binance',
      symbol: 'BTCUSD',
      type: 'book_change'
    })

    expect(orderBook.bestAsk()).toEqual({
      price: 200,
      amount: 20
    })

    expect(orderBook.bestBid()).toEqual({
      price: 119.5,
      amount: 21
    })

    expect(Array.from(orderBook.asks())).toEqual([
      { price: 200, amount: 20 },
      { price: 201, amount: 2000 }
    ])
    expect(Array.from(orderBook.bids())).toEqual([
      { price: 119.5, amount: 21 },
      { price: 118, amount: 200 }
    ])

    // update levels
    orderBook.update({
      asks: [
        { price: 200, amount: 20 },
        { price: 201, amount: 100 }
      ],
      bids: [{ price: 118, amount: 201 }],
      isSnapshot: false,
      localTimestamp: new Date(),
      timestamp: new Date(),
      exchange: 'binance',
      symbol: 'BTCUSD',
      type: 'book_change'
    })

    expect(orderBook.bestAsk()).toEqual({
      price: 200,
      amount: 20
    })

    expect(orderBook.bestBid()).toEqual({
      price: 119.5,
      amount: 21
    })

    expect(Array.from(orderBook.asks())).toEqual([
      { price: 200, amount: 20 },
      { price: 201, amount: 100 }
    ])
    expect(Array.from(orderBook.bids())).toEqual([
      { price: 119.5, amount: 21 },
      { price: 118, amount: 201 }
    ])

    // another book snapshot
    orderBook.update({
      asks: [
        { price: 200, amount: 200 },
        { price: 120, amount: 100 }
      ],
      bids: [{ price: 119, amount: 200 }],
      isSnapshot: true,
      localTimestamp: new Date(),
      timestamp: new Date(),
      exchange: 'binance',
      symbol: 'BTCUSD',
      type: 'book_change'
    })

    expect(orderBook.bestAsk()).toEqual({
      price: 120,
      amount: 100
    })
    expect(orderBook.bestBid()).toEqual({
      price: 119,
      amount: 200
    })

    expect(Array.from(orderBook.asks())).toEqual([
      { price: 120, amount: 100 },
      { price: 200, amount: 200 }
    ])
    expect(Array.from(orderBook.bids())).toEqual([{ price: 119, amount: 200 }])

    // delete for non existing level
    orderBook.update({
      asks: [{ price: 3000, amount: 0 }],
      bids: [],
      isSnapshot: false,
      localTimestamp: new Date(),
      timestamp: new Date(),
      exchange: 'binance',
      symbol: 'BTCUSD',
      type: 'book_change'
    })

    expect(orderBook.bestAsk()).toEqual({
      price: 120,
      amount: 100
    })
    expect(orderBook.bestBid()).toEqual({
      price: 119,
      amount: 200
    })

    expect(Array.from(orderBook.asks())).toEqual([
      { price: 120, amount: 100 },
      { price: 200, amount: 200 }
    ])
    expect(Array.from(orderBook.bids())).toEqual([{ price: 119, amount: 200 }])
  })

  test('matches a sorted map across snapshots, updates, and missing deletes', () => {
    const orderBook = new OrderBook()
    const expectedBids = new Map<number, number>()
    const expectedAsks = new Map<number, number>()
    let randomState = 0x12345678

    const nextRandom = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
      return randomState
    }
    const updateExpected = (levels: { price: number; amount: number }[], expected: Map<number, number>) => {
      for (const level of levels) {
        if (level.amount === 0) {
          expected.delete(level.price)
        } else {
          expected.set(level.price, level.amount)
        }
      }
    }
    const update = (bids: { price: number; amount: number }[], asks: { price: number; amount: number }[], isSnapshot = false) => {
      if (isSnapshot) {
        expectedBids.clear()
        expectedAsks.clear()
      }
      updateExpected(bids, expectedBids)
      updateExpected(asks, expectedAsks)
      orderBook.update({
        asks,
        bids,
        exchange: 'binance',
        isSnapshot,
        localTimestamp: new Date(),
        timestamp: new Date(),
        symbol: 'BTCUSD',
        type: 'book_change'
      })
    }
    const assertBook = () => {
      const bids = [...expectedBids].sort(([priceA], [priceB]) => priceB - priceA).map(([price, amount]) => ({ price, amount }))
      const asks = [...expectedAsks].sort(([priceA], [priceB]) => priceA - priceB).map(([price, amount]) => ({ price, amount }))

      expect(Array.from(orderBook.bids())).toEqual(bids)
      expect(Array.from(orderBook.asks())).toEqual(asks)
      expect(orderBook.bestBid()).toEqual(bids[0])
      expect(orderBook.bestAsk()).toEqual(asks[0])
    }

    update(
      Array.from({ length: 100 }, (_, index) => ({ price: 100 - index / 2, amount: index + 1 })),
      Array.from({ length: 100 }, (_, index) => ({ price: 101 + index / 2, amount: index + 1 })),
      true
    )

    for (let i = 0; i < 2_000; i++) {
      const bids = []
      const asks = []
      const changes = 1 + (nextRandom() % 4)
      for (let change = 0; change < changes; change++) {
        const level = {
          price: 50 + (nextRandom() % 20_000) / 100,
          amount: nextRandom() % 5 === 0 ? 0 : 1 + (nextRandom() % 100_000) / 100
        }
        ;(nextRandom() % 2 === 0 ? bids : asks).push(level)
      }
      update(bids, asks)

      if (i % 50 === 0) {
        assertBook()
      }
    }

    update(
      Array.from({ length: 25 }, (_, index) => ({ price: 200 - index, amount: index + 1 })),
      Array.from({ length: 25 }, (_, index) => ({ price: 201 + index, amount: index + 1 })),
      true
    )
    assertBook()
  })

  test('preserves crossed-level removal and callback behavior', () => {
    let callbackCount = 0
    const orderBook = new OrderBook({
      removeCrossedLevels: true,
      onCrossedLevelRemoved: () => callbackCount++
    })
    const update = (bids: { price: number; amount: number }[], asks: { price: number; amount: number }[], isSnapshot = false) =>
      orderBook.update({
        asks,
        bids,
        exchange: 'binance',
        isSnapshot,
        localTimestamp: new Date(),
        timestamp: new Date(),
        symbol: 'BTCUSD',
        type: 'book_change'
      })

    update(
      [
        { price: 100, amount: 1 },
        { price: 99, amount: 2 }
      ],
      [
        { price: 101, amount: 3 },
        { price: 102, amount: 4 }
      ],
      true
    )
    update([], [{ price: 98, amount: 5 }])

    expect(Array.from(orderBook.bids())).toEqual([])
    expect(Array.from(orderBook.asks())).toEqual([
      { price: 98, amount: 5 },
      { price: 101, amount: 3 },
      { price: 102, amount: 4 }
    ])
    expect(callbackCount).toBe(2)

    update([{ price: 103, amount: 6 }], [])

    expect(Array.from(orderBook.bids())).toEqual([{ price: 103, amount: 6 }])
    expect(Array.from(orderBook.asks())).toEqual([])
    expect(callbackCount).toBe(5)
  })

  test('does not invalidate an active iterator when updating an existing level or deleting a missing level', () => {
    const orderBook = new OrderBook()
    const updateAsks = (asks: { price: number; amount: number }[], isSnapshot = false) =>
      orderBook.update({
        asks,
        bids: [],
        exchange: 'binance',
        isSnapshot,
        localTimestamp: new Date(),
        timestamp: new Date(),
        symbol: 'BTCUSD',
        type: 'book_change'
      })

    updateAsks(
      [12, 7, 22, 1, 8, 3, 18, 6, 23, 2, 21, 16].map((price) => ({ price, amount: price })),
      true
    )

    const iteratorDuringUpdate = orderBook.asks()
    expect(Array.from({ length: 7 }, () => iteratorDuringUpdate.next().value.price)).toEqual([1, 2, 3, 6, 7, 8, 12])
    updateAsks([{ price: 18, amount: 180 }])
    expect(Array.from(iteratorDuringUpdate)).toEqual([
      { price: 16, amount: 16 },
      { price: 18, amount: 180 },
      { price: 21, amount: 21 },
      { price: 22, amount: 22 },
      { price: 23, amount: 23 }
    ])

    const iteratorDuringMissingDelete = orderBook.asks()
    expect(Array.from({ length: 7 }, () => iteratorDuringMissingDelete.next().value.price)).toEqual([1, 2, 3, 6, 7, 8, 12])
    updateAsks([{ price: 20, amount: 0 }])
    expect(Array.from(iteratorDuringMissingDelete)).toEqual([
      { price: 16, amount: 16 },
      { price: 18, amount: 180 },
      { price: 21, amount: 21 },
      { price: 22, amount: 22 },
      { price: 23, amount: 23 }
    ])
  })

  test('keeps an active iterator on the snapshot where iteration started', () => {
    const orderBook = new OrderBook()
    const updateAsks = (asks: { price: number; amount: number }[]) =>
      orderBook.update({
        asks,
        bids: [],
        exchange: 'binance',
        isSnapshot: true,
        localTimestamp: new Date(),
        timestamp: new Date(),
        symbol: 'BTCUSD',
        type: 'book_change'
      })

    updateAsks([1, 2, 3, 4].map((price) => ({ price, amount: price })))
    const iterator = orderBook.asks()
    expect(iterator.next().value).toEqual({ price: 1, amount: 1 })

    updateAsks([10, 11].map((price) => ({ price, amount: price })))

    expect(Array.from(iterator)).toEqual([
      { price: 2, amount: 2 },
      { price: 3, amount: 3 },
      { price: 4, amount: 4 }
    ])
    expect(Array.from(orderBook.asks())).toEqual([
      { price: 10, amount: 10 },
      { price: 11, amount: 11 }
    ])
  })
})
