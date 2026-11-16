import { test } from 'node:test'
import { stream, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

function book(sequence_no: number, action = 'update', symbol = 'BTCUSDT') {
  return {
    type: 'l2_updates',
    action,
    symbol,
    sequence_no,
    bids: [['100', String(sequence_no + 1)]],
    asks: [],
    timestamp: 1793955600000000
  }
}

for (const action of ['snapshot', 'update']) {
  for (const validateSequence of [true, false]) {
    test(`Delta ${action} gap: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
      const valid = [
        book(0, 'snapshot'),
        book(100, 'snapshot', 'ETHUSDT'),
        book(1),
        book(1),
        { type: 'l1_orderbook', symbol: 'BTCUSDT', last_sequence_no: 900 },
        { type: 'all_trades', symbol: 'BTCUSDT', sequence_no: 1000 },
        { type: 'pong' },
        { type: 'subscriptions', channels: [] },
        book(2, 'snapshot'),
        book(3),
        book(101, 'update', 'ETHUSDT')
      ]
      const gap = book(5, action)
      const errors: Error[] = []
      const { server, cleanup } = await createTestWebSocketServer('delta')
      server.on('connection', (socket) =>
        socket.once('message', () => {
          for (const message of [...valid, gap]) socket.send(JSON.stringify(message))
        })
      )
      const messages = stream({
        exchange: 'delta',
        filters: [{ channel: 'l2_updates', symbols: ['BTCUSDT', 'ETHUSDT'] }],
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
          assert.strictEqual(errors[0].exchange, 'delta')
          assert.strictEqual(errors[0].key, 'BTCUSDT')
          assert.strictEqual(errors[0].expectedPreviousSequence, 3)
          assert.strictEqual(errors[0].previousSequence, 4)
          assert.strictEqual(errors[0].sequence, 5)
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
}
