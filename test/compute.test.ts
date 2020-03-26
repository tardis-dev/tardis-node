import {
  BookChange,
  compute,
  computeBookSnapshots,
  computeTradeBars,
  normalizeBookChanges,
  normalizeTrades,
  replayNormalized,
  Trade
} from '../dist'

describe('compute(messages, types)', () => {
  test(
    'should compute requested types based on replayNormalized iterables',
    async () => {
      const normalizers = [normalizeTrades, normalizeBookChanges]
      const bitmexMessages = replayNormalized(
        {
          exchange: 'bitmex',
          from: '2019-04-01',
          to: '2019-04-01 00:01',
          symbols: ['XBTUSD'],
          withDisconnectMessages: true
        },
        ...normalizers
      )

      const bufferedMessages = []
      const withComputedTypes = compute(
        bitmexMessages,
        computeBookSnapshots({ depth: 10, interval: 1000 }),
        computeBookSnapshots({ depth: 5, interval: 0 }),
        computeBookSnapshots({ depth: 3, interval: 100 }),
        computeTradeBars({ kind: 'time', interval: 1000 }),
        computeTradeBars({ kind: 'tick', interval: 100 })
      )

      for await (const message of withComputedTypes) {
        bufferedMessages.push(message)
      }

      expect(bufferedMessages).toMatchSnapshot()
    },
    1000 * 60
  )

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

    expect(bufferedMessages).toMatchSnapshot()
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

    expect(bufferedMessages).toMatchSnapshot()
  })
})
