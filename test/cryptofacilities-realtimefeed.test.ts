import { test } from 'node:test'
import { stream, streamNormalized, normalizeBookChanges, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

function book(seq: number, product_id = 'PI_XBTUSD') {
  return { feed: 'book', product_id, seq, side: 'buy', price: 100, qty: seq + 1, timestamp: 1793955600000 }
}

function snapshot(seq: number, product_id = 'PI_XBTUSD') {
  return { feed: 'book_snapshot', product_id, seq, bids: [{ price: 100, qty: 1 }], asks: [], timestamp: 1793955600000 }
}

for (const validateSequence of [undefined, true, false]) {
  test(`Cryptofacilities book continuity: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const valid = [
      { event: 'subscribed', feed: 'book', product_ids: ['PI_XBTUSD', 'PF_ETHUSD'] },
      snapshot(900),
      book(0),
      book(100, 'PF_ETHUSD'),
      book(1),
      book(1),
      { feed: 'trade', product_id: 'PI_XBTUSD', seq: 8000 },
      { feed: 'ticker', product_id: 'PI_XBTUSD', seq: 9000 },
      { feed: 'heartbeat', time: 1793955600000 },
      { event: 'subscribed', feed: 'book', seq: 9001, product_id: 'PI_XBTUSD' },
      snapshot(9002),
      book(2),
      book(101, 'PF_ETHUSD')
    ]
    const gap = book(4)
    const errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('cryptofacilities')
    server.on('connection', (socket) =>
      socket.once('message', (bytes) => {
        assert.deepStrictEqual(JSON.parse(bytes.toString()), {
          event: 'subscribe',
          feed: 'book',
          product_ids: ['PF_ETHUSD', 'PI_XBTUSD']
        })
        for (const message of [...valid, gap]) socket.send(JSON.stringify(message))
      })
    )
    const messages = stream({
      exchange: 'cryptofacilities',
      filters: [{ channel: 'book', symbols: ['PI_XBTUSD', 'PF_ETHUSD'] }],
      timeoutIntervalMS: 0,
      validateSequence,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })
    try {
      for (const message of valid) assert.deepStrictEqual((await messages.next()).value?.message, message)
      const next = (await messages.next()).value
      if (validateSequence === false) {
        assert.deepStrictEqual(next?.message, gap)
        assert.deepStrictEqual(errors, [])
      } else {
        assert.strictEqual(next, undefined)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
        assert.strictEqual(errors[0].exchange, 'cryptofacilities')
        assert.strictEqual(errors[0].key, 'PI_XBTUSD')
        assert.strictEqual(errors[0].expectedPreviousSequence, 2)
        assert.strictEqual(errors[0].previousSequence, 3)
        assert.strictEqual(errors[0].sequence, 4)
      }
    } finally {
      try {
        await messages.return?.()
      } finally {
        await cleanup()
      }
    }
  })
}

for (const normalized of [false, true]) {
  for (const withDisconnects of [false, true]) {
    test(`Cryptofacilities recovery: normalized=${normalized}, disconnects=${withDisconnects}`, { timeout: 10000 }, async () => {
      let connections = 0
      const errors: Error[] = []
      const { server, cleanup } = await createTestWebSocketServer('cryptofacilities')
      server.on('connection', (socket) => {
        const first = ++connections === 1
        socket.once('message', (bytes) => {
          assert.strictEqual(JSON.parse(bytes.toString()).feed, 'book')
          for (const message of first ? [snapshot(100), book(101), book(103)] : [snapshot(0), book(1), book(2)]) {
            socket.send(JSON.stringify(message))
          }
        })
      })
      const options = {
        exchange: 'cryptofacilities' as const,
        timeoutIntervalMS: 0,
        onError: (error: Error) => errors.push(error)
      }
      const messages = normalized
        ? streamNormalized({ ...options, symbols: ['PI_XBTUSD'], withDisconnectMessages: withDisconnects }, normalizeBookChanges)
        : stream({ ...options, filters: [{ channel: 'book', symbols: ['PI_XBTUSD'] }], withDisconnects })
      const output: any[] = []
      try {
        for await (const item of messages) {
          output.push(item)
          if (output.length === (withDisconnects ? 6 : 5)) break
        }
        if (withDisconnects) {
          if (normalized) assert.strictEqual(output[2].type, 'disconnect')
          else assert.strictEqual(output[2], undefined)
          output.splice(2, 1)
        }
        if (normalized) {
          assert.deepStrictEqual(
            output.map((item) => item.isSnapshot),
            [true, false, true, false, false]
          )
          assert.deepStrictEqual(
            output.map((item) => item.bids),
            [1, 102, 1, 2, 3].map((amount) => [{ price: 100, amount }])
          )
        } else {
          assert.deepStrictEqual(
            output.map((item) => item.message),
            [snapshot(100), book(101), snapshot(0), book(1), book(2)]
          )
        }
        assert.strictEqual(connections, 2)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
      } finally {
        try {
          await messages.return?.()
        } finally {
          await cleanup()
        }
      }
    })
  }
}

test('Cryptofacilities normalized opt-out preserves book deltas across a gap', { timeout: 10000 }, async () => {
  let connections = 0
  const { server, cleanup } = await createTestWebSocketServer('cryptofacilities')
  server.on('connection', (socket) => {
    connections++
    socket.once('message', () => {
      for (const message of [snapshot(100), book(101), book(103)]) socket.send(JSON.stringify(message))
    })
  })
  const errors: Error[] = []
  const messages = streamNormalized(
    {
      exchange: 'cryptofacilities',
      symbols: ['PI_XBTUSD'],
      timeoutIntervalMS: 0,
      validateSequence: false,
      withDisconnectMessages: true,
      onError: (error) => errors.push(error)
    },
    normalizeBookChanges
  )
  try {
    const output = [(await messages.next()).value, (await messages.next()).value, (await messages.next()).value]
    assert.deepStrictEqual(
      output.map((item) => item.type),
      ['book_change', 'book_change', 'book_change']
    )
    assert.deepStrictEqual(
      output.map((item) => item.type === 'book_change' && item.isSnapshot),
      [true, false, false]
    )
    assert.strictEqual(connections, 1)
    assert.deepStrictEqual(errors, [])
  } finally {
    try {
      await messages.return?.()
    } finally {
      await cleanup()
    }
  }
})

test('Cryptofacilities initializes normalized books when markets send only snapshots', { timeout: 10000 }, async () => {
  const { server, cleanup } = await createTestWebSocketServer('cryptofacilities')
  server.on('connection', (socket) =>
    socket.once('message', () => {
      socket.send(JSON.stringify(snapshot(100)))
      socket.send(JSON.stringify(snapshot(900, 'PF_ETHUSD')))
    })
  )
  const errors: Error[] = []
  const messages = streamNormalized(
    {
      exchange: 'cryptofacilities',
      symbols: ['PI_XBTUSD', 'PF_ETHUSD'],
      timeoutIntervalMS: 0,
      onError: (error) => errors.push(error)
    },
    normalizeBookChanges
  )
  try {
    for (const symbol of ['PI_XBTUSD', 'PF_ETHUSD']) {
      const item = (await messages.next()).value
      assert.strictEqual(item.symbol, symbol)
      assert.strictEqual(item.isSnapshot, true)
      assert.deepStrictEqual(item.bids, [{ price: 100, amount: 1 }])
    }
    assert.deepStrictEqual(errors, [])
  } finally {
    try {
      await messages.return?.()
    } finally {
      await cleanup()
    }
  }
})
