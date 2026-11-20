import { test } from 'node:test'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'
import { SequenceGapError, stream } from '../dist/index.js'

for (const exchange of ['okex', 'okex-futures', 'okex-swap', 'okex-options'] as const) {
  for (const validateSequence of [true, false]) {
    test(`${exchange} depth continuity: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
      const depth = (action: string, pairs: [number, number][], instId = 'BTC-USDT') => ({
        arg: { channel: 'books', instId },
        action,
        data: pairs.map(([seqId, prevSeqId]) => ({ seqId, prevSeqId, asks: [], bids: [], ts: '1794300000000' }))
      })
      const native = [
        { event: 'subscribe', arg: { channel: 'books', instId: 'BTC-USDT' } },
        depth('update', [[100, 99]]),
        depth('update', [
          [105, 100],
          [110, 105]
        ]),
        depth('update', [[110, 105]]),
        depth('update', [[110, 110]]),
        depth('update', [
          [3, 110],
          [5, 3]
        ]),
        depth('snapshot', [
          [500, -1],
          [505, -1]
        ]),
        depth('update', [[510, 505]]),
        depth('snapshot', [[0, -1]]),
        depth('update', [[1, 0]]),
        depth('snapshot', [[800, -1]], 'ETH-USDT'),
        depth('update', [[805, 800]], 'ETH-USDT'),
        { ...depth('update', [[9999, 9998]]), arg: { channel: 'books5', instId: 'BTC-USDT' } },
        { ...depth('update', [[9999, 9998]]), arg: { channel: 'books-l2-tbt', instId: 'BTC-USDT' } },
        { ...depth('update', [[9999, 9998]]), arg: { channel: 'books50-l2-tbt', instId: 'BTC-USDT' } },
        { ...depth('update', [[9999, 9998]]), arg: { channel: 'bbo-tbt', instId: 'BTC-USDT' } },
        depth('update', [[9999, 9998]], ''),
        depth('update', [[2, 1]])
      ]
      const gap = depth('update', [
          [5, 4],
          [6, 5]
        ]),
        errors: Error[] = []
      const { server, cleanup } = await createTestWebSocketServer(exchange)
      server.on('connection', (socket) =>
        socket.once('message', (bytes) => {
          assert.deepStrictEqual(JSON.parse(bytes.toString()), {
            op: 'subscribe',
            args: [
              { channel: 'books', instId: 'BTC-USDT' },
              { channel: 'books', instId: 'ETH-USDT' }
            ]
          })
          for (const message of [...native, gap]) socket.send(JSON.stringify(message))
        })
      )
      const messages = stream({
        exchange,
        filters: [{ channel: 'books', symbols: ['BTC-USDT', 'ETH-USDT'] }],
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
          assert.strictEqual(errors[0].exchange, exchange)
          assert.strictEqual(errors[0].key, 'BTC-USDT')
          assert.strictEqual(errors[0].expectedPreviousSequence, 2)
          assert.strictEqual(errors[0].previousSequence, 4)
          assert.strictEqual(errors[0].sequence, 6)
        }
      } finally {
        await messages.return?.()
        await cleanup()
      }
    })
  }

  for (const validateSequence of [undefined, false]) {
    test(`${exchange} rejects a gap inside a depth batch: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
      const snapshot = { arg: { channel: 'books', instId: 'BTC-USDT' }, action: 'snapshot', data: [{ seqId: 100, prevSeqId: -1 }] }
      // The first prevSeqId and final seqId hide a broken middle link unless every adjacent entry is checked.
      const gap = {
        arg: snapshot.arg,
        action: 'update',
        data: [
          { seqId: 105, prevSeqId: 100 },
          { seqId: 110, prevSeqId: 109 },
          { seqId: 115, prevSeqId: 110 }
        ]
      }
      const errors: Error[] = [],
        { server, cleanup } = await createTestWebSocketServer(exchange)
      server.on('connection', (socket) =>
        socket.once('message', () => {
          for (const message of [snapshot, gap]) socket.send(JSON.stringify(message))
        })
      )
      const messages = stream({
        exchange,
        filters: [{ channel: 'books', symbols: ['BTC-USDT'] }],
        timeoutIntervalMS: 0,
        validateSequence,
        withDisconnects: true,
        onError: (error) => errors.push(error)
      })
      try {
        assert.deepStrictEqual((await messages.next()).value?.message, snapshot)
        const next = (await messages.next()).value
        if (validateSequence === false) {
          assert.deepStrictEqual(next?.message, gap)
          assert.deepStrictEqual(errors, [])
        } else {
          assert.strictEqual(next, undefined)
          assert.strictEqual(errors.length, 1)
          assert.ok(errors[0] instanceof SequenceGapError)
          assert.strictEqual(errors[0].exchange, exchange)
          assert.strictEqual(errors[0].key, 'BTC-USDT')
          assert.strictEqual(errors[0].expectedPreviousSequence, 105)
          assert.strictEqual(errors[0].previousSequence, 109)
          assert.strictEqual(errors[0].sequence, 110)
        }
      } finally {
        await messages.return?.()
        await cleanup()
      }
    })
  }
}
