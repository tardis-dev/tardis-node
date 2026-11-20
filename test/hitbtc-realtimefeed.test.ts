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

for (const validateSequence of [true, false]) {
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
