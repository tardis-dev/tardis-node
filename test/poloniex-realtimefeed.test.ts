import { test } from 'node:test'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'
import { normalizeBookChanges, SequenceGapError, stream, streamNormalized } from '../dist/index.js'

for (const validateSequence of [undefined, true, false]) {
  test(`Poloniex depth continuity: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const depth = (action: string, id: number, lastId: number, symbol = 'BTC_USDT') => ({
      channel: 'book_lv2',
      action,
      data: [{ symbol, id, lastId, bids: [], asks: [], createTime: 1794300000000, ts: 1794300000000 }]
    })
    const native = [
      { event: 'subscribe', channel: 'book_lv2', symbols: ['BTC_USDT', 'ETH_USDT'] },
      { event: 'pong' },
      depth('update', 100, 99),
      depth('update', 105, 100),
      depth('update', 105, 100),
      depth('snapshot', 500, 499),
      depth('update', 505, 500),
      depth('snapshot', 0, -1),
      depth('update', 1, 0),
      depth('snapshot', 800, 799, 'ETH_USDT'),
      depth('update', 805, 800, 'ETH_USDT'),
      { ...depth('update', 9999, 9998), channel: 'book' },
      { ...depth('snapshot', 9999, 9998), channel: 'ticker' },
      depth('update', 2, 1)
    ]
    const gap = depth('update', 5, 4),
      errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('poloniex')
    server.on('connection', (socket) =>
      socket.once('message', (bytes) => {
        assert.deepStrictEqual(JSON.parse(bytes.toString()), {
          event: 'subscribe',
          channel: ['book_lv2'],
          symbols: ['BTC_USDT', 'ETH_USDT']
        })
        for (const message of [...native, gap]) socket.send(JSON.stringify(message))
      })
    )
    const messages = stream({
      exchange: 'poloniex',
      filters: [{ channel: 'book_lv2', symbols: ['BTC_USDT', 'ETH_USDT'] }],
      timeoutIntervalMS: 0,
      validateSequence,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })
    try {
      for (const message of native) assert.deepStrictEqual((await messages.next()).value?.message, message)
      const next = (await messages.next()).value
      if (validateSequence === false) {
        assert.deepStrictEqual(next?.message, gap)
        assert.deepStrictEqual(errors, [])
      } else {
        assert.strictEqual(next, undefined)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
        assert.strictEqual(errors[0].exchange, 'poloniex')
        assert.strictEqual(errors[0].key, 'BTC_USDT')
        assert.strictEqual(errors[0].expectedPreviousSequence, 2)
        assert.strictEqual(errors[0].previousSequence, 4)
        assert.strictEqual(errors[0].sequence, 5)
      }
    } finally {
      await messages.return?.()
      await cleanup()
    }
  })
}

for (const normalized of [false, true]) {
  for (const withDisconnects of [false, true]) {
    test(`Poloniex depth recovery: normalized=${normalized}, disconnects=${withDisconnects}`, { timeout: 10000 }, async () => {
      const depth = (action: string, id: number, lastId: number) => ({
        channel: 'book_lv2',
        action,
        data: [{ symbol: 'BTC_USDT', id, lastId, ts: 1794300000000, createTime: 1794300000000, bids: [['100', String(id)]], asks: [] }]
      })
      let connections = 0
      const errors: Error[] = [],
        initial = [depth('snapshot', 100, 99), depth('update', 105, 100), depth('update', 110, 109)],
        recovered = [depth('snapshot', 0, -1), depth('update', 2, 0)],
        { server, cleanup } = await createTestWebSocketServer('poloniex')
      server.on('connection', (socket) => {
        const first = ++connections === 1
        socket.once('message', () => {
          for (const message of first ? initial : recovered) socket.send(JSON.stringify(message))
        })
      })
      const options = { exchange: 'poloniex' as const, timeoutIntervalMS: 0, onError: (error: Error) => errors.push(error) }
      const messages = normalized
        ? streamNormalized({ ...options, symbols: ['BTC_USDT'], withDisconnectMessages: withDisconnects }, normalizeBookChanges)
        : stream({ ...options, filters: [{ channel: 'book_lv2', symbols: ['BTC_USDT'] }], withDisconnects })
      const output: any[] = []
      try {
        for await (const message of messages) {
          output.push(message)
          if (output.length === (withDisconnects ? 5 : 4)) break
        }
        if (withDisconnects) {
          assert.strictEqual(normalized ? output[2].type : output[2], normalized ? 'disconnect' : undefined)
          output.splice(2, 1)
        }
        if (normalized) {
          assert.deepStrictEqual(
            output.map((m) => m.isSnapshot),
            [true, false, true, false]
          )
          assert.deepStrictEqual(
            output.map((m) => m.bids),
            [100, 105, 0, 2].map((amount) => [{ price: 100, amount }])
          )
        } else
          assert.deepStrictEqual(
            output.map((m) => m.message),
            [...initial.slice(0, 2), ...recovered]
          )
        assert.strictEqual(connections, 2)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
      } finally {
        await messages.return?.()
        await cleanup()
      }
    })
  }
}

test('Poloniex normalized opt-out preserves snapshot resets and gaps', { timeout: 10000 }, async () => {
  const errors: Error[] = [],
    { server, cleanup } = await createTestWebSocketServer('poloniex')
  server.on('connection', (socket) =>
    socket.once('message', () => {
      for (const [action, id, lastId] of [
        ['snapshot', 100, 99],
        ['update', 110, 109],
        ['snapshot', 0, -1],
        ['update', 2, 0]
      ]) {
        socket.send(
          JSON.stringify({
            channel: 'book_lv2',
            action,
            data: [{ symbol: 'BTC_USDT', id, lastId, ts: 1794300000000, createTime: 1794300000000, bids: [['100', String(id)]], asks: [] }]
          })
        )
      }
    })
  )
  const messages = streamNormalized(
    { exchange: 'poloniex', symbols: ['BTC_USDT'], timeoutIntervalMS: 0, validateSequence: false, onError: (error) => errors.push(error) },
    normalizeBookChanges
  )
  try {
    for (const amount of [100, 110, 0, 2]) assert.deepStrictEqual((await messages.next()).value.bids, [{ price: 100, amount }])
    assert.deepStrictEqual(errors, [])
  } finally {
    await messages.return?.()
    await cleanup()
  }
})
