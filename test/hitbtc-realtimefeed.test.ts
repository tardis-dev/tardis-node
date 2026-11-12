import { test } from 'node:test'
import { stream, streamNormalized, normalizeBookChanges, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

function book(sequence: number, method = 'updateOrderbook', symbol = 'BTCUSD') {
  return {
    method,
    params: { symbol, sequence, timestamp: '2026-11-06T09:00:00.000Z', bid: [{ price: '100', size: String(sequence + 1) }], ask: [] }
  }
}

for (const validateSequence of [undefined, true, false]) {
  test(`HitBTC continuity and snapshot resets: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const valid = [
      { id: 1, result: true },
      book(0, 'snapshotOrderbook'),
      book(100, 'snapshotOrderbook', 'ETHUSD'),
      book(1),
      book(1),
      { method: 'snapshotTrades', params: { symbol: 'BTCUSD', sequence: 9000, data: [] } },
      { method: 'updateTrades', params: { symbol: 'BTCUSD', sequence: 9999, data: [] } },
      book(500, 'snapshotOrderbook'),
      book(501),
      book(101, 'updateOrderbook', 'ETHUSD')
    ]
    const gap = book(503),
      errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('hitbtc')
    server.on('connection', (socket) =>
      socket.once('message', () => {
        for (const message of [...valid, gap]) socket.send(JSON.stringify(message))
      })
    )
    const messages = stream({
      exchange: 'hitbtc',
      filters: [{ channel: 'updateOrderbook', symbols: ['BTCUSD', 'ETHUSD'] }],
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
        assert.strictEqual(errors[0].exchange, 'hitbtc')
        assert.strictEqual(errors[0].key, 'BTCUSD')
        assert.strictEqual(errors[0].expectedPreviousSequence, 501)
        assert.strictEqual(errors[0].previousSequence, 502)
        assert.strictEqual(errors[0].sequence, 503)
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
    test(`HitBTC recovery: normalized=${normalized}, disconnects=${withDisconnects}`, { timeout: 10000 }, async () => {
      let connections = 0
      const errors: Error[] = []
      const { server, cleanup } = await createTestWebSocketServer('hitbtc')
      server.on('connection', (socket) => {
        const first = ++connections === 1
        socket.once('message', () => {
          const ids = first ? [100, 101, 103] : [1, 2]
          for (const [i, id] of ids.entries()) socket.send(JSON.stringify(book(id, i === 0 ? 'snapshotOrderbook' : 'updateOrderbook')))
        })
      })
      const options = { exchange: 'hitbtc' as const, timeoutIntervalMS: 0, onError: (error: Error) => errors.push(error) }
      const messages = normalized
        ? streamNormalized({ ...options, symbols: ['BTCUSD'], withDisconnectMessages: withDisconnects }, normalizeBookChanges)
        : stream({ ...options, filters: [{ channel: 'updateOrderbook', symbols: ['BTCUSD'] }], withDisconnects })
      const output: any[] = []
      try {
        for await (const item of messages) {
          output.push(item)
          if (output.length === (withDisconnects ? 5 : 4)) break
        }
        if (withDisconnects) {
          assert.strictEqual(normalized ? output[2].type : output[2], normalized ? 'disconnect' : undefined)
          output.splice(2, 1)
        }
        if (normalized) {
          assert.deepStrictEqual(
            output.map((item) => item.isSnapshot),
            [true, false, true, false]
          )
          assert.deepStrictEqual(
            output.map((item) => item.bids),
            [101, 102, 2, 3].map((amount) => [{ price: 100, amount }])
          )
        } else
          assert.deepStrictEqual(
            output.map((item) => item.message),
            [book(100, 'snapshotOrderbook'), book(101), book(1, 'snapshotOrderbook'), book(2)]
          )
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

for (const withDisconnectMessages of [false, true]) {
  test(`HitBTC normalized opt-out: disconnects=${withDisconnectMessages}`, { timeout: 10000 }, async () => {
    let connections = 0
    const errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('hitbtc')
    server.on('connection', (socket) => {
      connections++
      socket.once('message', () => {
        for (const message of [book(100, 'snapshotOrderbook'), book(101), book(103)]) socket.send(JSON.stringify(message))
      })
    })
    const messages = streamNormalized(
      {
        exchange: 'hitbtc',
        symbols: ['BTCUSD'],
        timeoutIntervalMS: 0,
        validateSequence: false,
        withDisconnectMessages,
        onError: (error) => errors.push(error)
      },
      normalizeBookChanges
    )
    try {
      for (const isSnapshot of [true, false, false]) {
        const item = (await messages.next()).value
        assert.ok(item.type === 'book_change')
        assert.strictEqual(item.isSnapshot, isSnapshot)
      }
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
}

test('HitBTC initializes a quiet normalized book from a native snapshot', { timeout: 10000 }, async () => {
  const { server, cleanup } = await createTestWebSocketServer('hitbtc')
  server.on('connection', (socket) => socket.once('message', () => socket.send(JSON.stringify(book(100, 'snapshotOrderbook')))))
  const messages = streamNormalized({ exchange: 'hitbtc', symbols: ['BTCUSD'], timeoutIntervalMS: 0 }, normalizeBookChanges)
  try {
    const item = (await messages.next()).value
    assert.strictEqual(item.isSnapshot, true)
    assert.deepStrictEqual(item.bids, [{ price: 100, amount: 101 }])
  } finally {
    try {
      await messages.return?.()
    } finally {
      await cleanup()
    }
  }
})
