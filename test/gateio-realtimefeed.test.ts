import { test } from 'node:test'
import { stream, streamNormalized, normalizeBookChanges, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

function book(u: number, U?: number, symbol = 'BTC_USDT') {
  return {
    channel: 'spot.obu',
    event: 'update',
    result: {
      s: `ob.${symbol}.400`,
      t: 1793955600000,
      u,
      ...(U === undefined ? { full: true } : { U }),
      b: [['100', String(u + 1)]],
      a: []
    }
  }
}

for (const validateSequence of [undefined, true, false]) {
  test(`Gate spot ranges and resets: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const valid = [
      { channel: 'spot.obu', event: 'subscribe', result: { status: 'success' } },
      book(0),
      book(2, 1),
      book(2, 1),
      book(900, undefined, 'ETH_USDT'),
      { channel: 'spot.book_ticker', event: 'update', result: { s: 'BTC_USDT', u: 9999 } },
      { channel: 'spot.order_book_update', event: 'update', result: { s: 'BTC_USDT', U: 300, u: 301 } },
      book(500),
      book(502, 501),
      book(901, 901, 'ETH_USDT')
    ]
    const gap = book(505, 504),
      errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('gate-io')
    server.on('connection', (socket) =>
      socket.once('message', () => {
        for (const message of [...valid, gap]) socket.send(JSON.stringify(message))
      })
    )
    const messages = stream({
      exchange: 'gate-io',
      filters: [{ channel: 'obu', symbols: ['BTC_USDT', 'ETH_USDT'] }],
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
        assert.strictEqual(errors[0].exchange, 'gate-io')
        assert.strictEqual(errors[0].key, 'BTC_USDT')
        assert.strictEqual(errors[0].expectedPreviousSequence, 502)
        assert.strictEqual(errors[0].previousSequence, 503)
        assert.strictEqual(errors[0].sequence, 505)
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

for (const validateSequence of [undefined, false]) {
  for (const withDisconnectMessages of [false, true]) {
    test(
      `Gate spot normalized recovery: validation=${validateSequence ?? 'default'}, disconnects=${withDisconnectMessages}`,
      { timeout: 10000 },
      async () => {
        let connections = 0
        const errors: Error[] = []
        const { server, cleanup } = await createTestWebSocketServer('gate-io')
        server.on('connection', (socket) => {
          const first = ++connections === 1
          socket.once('message', () => {
            for (const message of first ? [book(100), book(101, 101), book(103, 103)] : [book(0), book(1, 1)])
              socket.send(JSON.stringify(message))
          })
        })
        const messages = streamNormalized(
          {
            exchange: 'gate-io',
            symbols: ['BTC_USDT'],
            timeoutIntervalMS: 0,
            validateSequence,
            withDisconnectMessages,
            onError: (error) => errors.push(error)
          },
          normalizeBookChanges
        )
        try {
          assert.strictEqual((await messages.next()).value.type, 'book_change')
          assert.strictEqual((await messages.next()).value.type, 'book_change')
          if (validateSequence === false) {
            const update = (await messages.next()).value
            assert.ok(update.type === 'book_change' && !update.isSnapshot)
            assert.deepStrictEqual(update.bids, [{ price: 100, amount: 104 }])
            assert.strictEqual(connections, 1)
            assert.deepStrictEqual(errors, [])
          } else {
            if (withDisconnectMessages) assert.strictEqual((await messages.next()).value.type, 'disconnect')
            const snapshot = (await messages.next()).value
            assert.ok(snapshot.type === 'book_change' && snapshot.isSnapshot)
            assert.deepStrictEqual(snapshot.bids, [{ price: 100, amount: 1 }])
            const update = (await messages.next()).value
            assert.ok(update.type === 'book_change' && !update.isSnapshot)
            assert.strictEqual(connections, 2)
            assert.strictEqual(errors.length, 1)
            assert.ok(errors[0] instanceof SequenceGapError)
          }
        } finally {
          try {
            await messages.return?.()
          } finally {
            await cleanup()
          }
        }
      }
    )
  }
}

test('Gate spot emits a quiet market snapshot without waiting for deltas', { timeout: 10000 }, async () => {
  const { server, cleanup } = await createTestWebSocketServer('gate-io')
  server.on('connection', (socket) => socket.once('message', () => socket.send(JSON.stringify(book(100)))))
  const messages = streamNormalized({ exchange: 'gate-io', symbols: ['BTC_USDT'], timeoutIntervalMS: 0 }, normalizeBookChanges)
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
