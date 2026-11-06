import { test } from 'node:test'
import { stream, streamNormalized, normalizeBookChanges, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

function depth(U: number, u = U, s = 'btcusd') {
  return { e: 'depthUpdate', E: 1793955600000000000, s, U, u, b: [['100', String(u)]], a: [] }
}

for (const validateSequence of [undefined, true, false]) {
  test(`Gemini overlapping ranges and stale updates: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const valid = [
      { id: 1, status: 200 },
      depth(100, 105),
      depth(900, 901, 'ethusd'),
      depth(104, 110),
      depth(104, 110),
      depth(100, 106),
      { s: 'btcusd', u: 9999, b: '100', B: '1', a: '101', A: '2', E: 1793955600000000000 },
      { s: 'btcusd', t: 123, p: '100', q: '1', m: false, E: 1793955600000000000 },
      { type: 'l2_updates', symbol: 'BTCUSD', changes: [] },
      depth(111, 115),
      depth(90, 118),
      depth(901, 905, 'ethusd'),
      depth(0, 0, 'xrpusd'),
      depth(1, 2, 'xrpusd')
    ]
    const gap = depth(120, 123),
      errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('gemini')
    server.on('connection', (socket) =>
      socket.once('message', (bytes) => {
        assert.deepStrictEqual(JSON.parse(bytes.toString()), {
          method: 'SUBSCRIBE',
          params: ['btcusd@depth@100ms', 'ethusd@depth@100ms', 'xrpusd@depth@100ms'],
          id: 1
        })
        for (const message of [...valid, gap]) socket.send(JSON.stringify(message))
      })
    )
    const messages = stream({
      exchange: 'gemini',
      filters: [{ channel: 'depth', symbols: ['BTCUSD', 'ETHUSD', 'XRPUSD'] }],
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
        assert.strictEqual(errors[0].exchange, 'gemini')
        assert.strictEqual(errors[0].key, 'btcusd')
        assert.strictEqual(errors[0].expectedPreviousSequence, 118)
        assert.strictEqual(errors[0].previousSequence, 119)
        assert.strictEqual(errors[0].sequence, 123)
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
    test(
      `Gemini repeated recovery clears range state: normalized=${normalized}, disconnects=${withDisconnects}`,
      { timeout: 10000 },
      async () => {
        let connections = 0
        const errors: Error[] = []
        const { server, cleanup } = await createTestWebSocketServer('gemini')
        server.on('connection', (socket) => {
          const generation = ++connections
          socket.once('message', () => {
            const ids = generation === 1 ? [100, 101, 103] : generation === 2 ? [1, 2, 4] : [10, 11]
            for (const id of ids) socket.send(JSON.stringify(depth(id)))
          })
        })
        const options = { exchange: 'gemini' as const, timeoutIntervalMS: 0, onError: (error: Error) => errors.push(error) }
        const messages = normalized
          ? streamNormalized({ ...options, symbols: ['BTCUSD'], withDisconnectMessages: withDisconnects }, normalizeBookChanges)
          : stream({ ...options, filters: [{ channel: 'depth', symbols: ['BTCUSD'] }], withDisconnects })
        const output: any[] = []
        try {
          for await (const item of messages) {
            output.push(item)
            if (output.length === (withDisconnects ? 8 : 6)) break
          }
          if (withDisconnects) {
            for (const index of [5, 2]) {
              assert.strictEqual(normalized ? output[index].type : output[index], normalized ? 'disconnect' : undefined)
              output.splice(index, 1)
            }
          }
          if (normalized) {
            assert.deepStrictEqual(
              output.map((item) => item.isSnapshot),
              [true, false, true, false, true, false]
            )
            assert.deepStrictEqual(
              output.map((item) => item.bids),
              [100, 101, 1, 2, 10, 11].map((amount) => [{ price: 100, amount }])
            )
          } else
            assert.deepStrictEqual(
              output.map((item) => item.message),
              [100, 101, 1, 2, 10, 11].map((id) => depth(id))
            )
          assert.strictEqual(connections, 3)
          assert.strictEqual(errors.length, 2)
          assert.ok(errors.every((error) => error instanceof SequenceGapError))
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

for (const withDisconnectMessages of [false, true]) {
  test(`Gemini normalized opt-out continues across a gap: disconnects=${withDisconnectMessages}`, { timeout: 10000 }, async () => {
    let connections = 0
    const errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('gemini')
    server.on('connection', (socket) => {
      connections++
      socket.once('message', () => {
        for (const message of [depth(100), depth(101), depth(103)]) socket.send(JSON.stringify(message))
      })
    })
    const messages = streamNormalized(
      {
        exchange: 'gemini',
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

test('Gemini initializes a quiet normalized book from its first depth message', { timeout: 10000 }, async () => {
  const { server, cleanup } = await createTestWebSocketServer('gemini')
  server.on('connection', (socket) => socket.once('message', () => socket.send(JSON.stringify(depth(100)))))
  const messages = streamNormalized({ exchange: 'gemini', symbols: ['BTCUSD'], timeoutIntervalMS: 0 }, normalizeBookChanges)
  try {
    const item = (await messages.next()).value
    assert.strictEqual(item.isSnapshot, true)
    assert.deepStrictEqual(item.bids, [{ price: 100, amount: 100 }])
  } finally {
    try {
      await messages.return?.()
    } finally {
      await cleanup()
    }
  }
})
