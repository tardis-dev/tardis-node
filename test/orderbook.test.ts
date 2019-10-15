import { OrderBook } from '../src'

describe('orderbook', () => {
  test('should update levels', () => {
    const orderBook = new OrderBook()
    // update before snapshot
    let updatedDepthInfo = orderBook.update({
      asks: [{ price: 200, amount: 20 }, { price: 120, amount: 1 }],
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
    expect(updatedDepthInfo.lowestUpdatedAskDepthIndex).toBeUndefined
    expect(updatedDepthInfo.lowestUpdatedBidDepthIndex).toBeUndefined

    // initial snapshot
    updatedDepthInfo = orderBook.update({
      asks: [{ price: 200, amount: 20 }, { price: 120, amount: 1 }],
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

    expect(updatedDepthInfo.lowestUpdatedAskDepthIndex).toBe(0)
    expect(updatedDepthInfo.lowestUpdatedBidDepthIndex).toBe(0)

    expect(Array.from(orderBook.asks())).toEqual([{ price: 120, amount: 1 }, { price: 200, amount: 20 }])
    expect(Array.from(orderBook.bids())).toEqual([{ price: 119, amount: 20 }])

    // bids and asks updates
    updatedDepthInfo = orderBook.update({
      asks: [{ price: 201, amount: 2000 }, { price: 120, amount: 100 }],
      bids: [{ price: 118, amount: 200 }, { price: 119, amount: 201 }, { price: 119.5, amount: 21 }],
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

    expect(updatedDepthInfo.lowestUpdatedAskDepthIndex).toBe(0)
    expect(updatedDepthInfo.lowestUpdatedBidDepthIndex).toBe(0)

    expect(Array.from(orderBook.asks())).toEqual([{ price: 120, amount: 100 }, { price: 200, amount: 20 }, { price: 201, amount: 2000 }])
    expect(Array.from(orderBook.bids())).toEqual([{ price: 119.5, amount: 21 }, { price: 119, amount: 201 }, { price: 118, amount: 200 }])

    // delete levels
    updatedDepthInfo = orderBook.update({
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

    expect(updatedDepthInfo.lowestUpdatedAskDepthIndex).toBe(0)
    expect(updatedDepthInfo.lowestUpdatedBidDepthIndex).toBe(1)

    expect(Array.from(orderBook.asks())).toEqual([{ price: 200, amount: 20 }, { price: 201, amount: 2000 }])
    expect(Array.from(orderBook.bids())).toEqual([{ price: 119.5, amount: 21 }, { price: 118, amount: 200 }])

    // update levels
    updatedDepthInfo = orderBook.update({
      asks: [{ price: 200, amount: 20 }, { price: 201, amount: 100 }],
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

    expect(updatedDepthInfo.lowestUpdatedAskDepthIndex).toBe(1)
    expect(updatedDepthInfo.lowestUpdatedBidDepthIndex).toBe(1)

    expect(Array.from(orderBook.asks())).toEqual([{ price: 200, amount: 20 }, { price: 201, amount: 100 }])
    expect(Array.from(orderBook.bids())).toEqual([{ price: 119.5, amount: 21 }, { price: 118, amount: 201 }])

    // another book snapshot
    updatedDepthInfo = orderBook.update({
      asks: [{ price: 200, amount: 200 }, { price: 120, amount: 100 }],
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
    expect(updatedDepthInfo.lowestUpdatedAskDepthIndex).toBe(0)
    expect(updatedDepthInfo.lowestUpdatedBidDepthIndex).toBe(0)

    expect(Array.from(orderBook.asks())).toEqual([{ price: 120, amount: 100 }, { price: 200, amount: 200 }])
    expect(Array.from(orderBook.bids())).toEqual([{ price: 119, amount: 200 }])
  })
})
