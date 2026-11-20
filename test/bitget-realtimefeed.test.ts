import { test } from 'node:test'
import { stream, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

for (const [exchange, instType, symbol] of [
  ['bitget', 'spot', 'BTCUSDT'],
  ['bitget-futures', 'usdt-futures', 'BTCUSDT'],
  ['bitget-futures', 'usdc-futures', 'BTCPERP'],
  ['bitget-futures', 'coin-futures', 'BTCUSD_CM']
] as const) {
  for (const validateSequence of [undefined, false]) {
    test(
      `${exchange} ${instType}: sequence validation ${validateSequence === false ? 'disabled' : 'default'}`,
      { timeout: 10000 },
      async () => {
        const book = (seq: number, pseq: number, action = 'update', topic = 'books') => ({
          arg: { instType, topic, symbol },
          action,
          data: [{ seq, pseq, a: [], b: [['100', '1']], checksum: 0, ts: '1793786400000' }],
          ts: 1793786400000
        })
        const errors: Error[] = []
        const valid = [
          book(100, 0, 'snapshot'),
          // The first update can span the snapshot's sequence; only update-to-update links are checked.
          book(110, 90),
          book(120, 110),
          book(500, 0, 'snapshot', 'books1'),
          book(800, 0, 'snapshot', 'books1'),
          book(1, 0),
          book(2, 1)
        ]
        const gap = book(4, 3)
        const { server, cleanup } = await createTestWebSocketServer(exchange)
        server.on('connection', (socket) => {
          socket.on('message', (bytes) => {
            const subscription = JSON.parse(bytes.toString())
            assert.deepStrictEqual(subscription, { op: 'subscribe', args: [{ instType, topic: 'books', symbol }] })
            for (const message of [{ event: 'subscribe', arg: { instType, topic: 'books', symbol } }, ...valid, gap]) {
              socket.send(JSON.stringify(message))
            }
          })
        })
        const messages = stream({
          exchange,
          filters: [{ channel: 'books', symbols: [symbol] }],
          timeoutIntervalMS: 0,
          validateSequence,
          withDisconnects: true,
          onError: (error) => errors.push(error)
        })

        try {
          await messages.next() // Subscription acknowledgement.
          for (const message of valid) {
            assert.deepStrictEqual((await messages.next()).value?.message, message)
          }
          const next = (await messages.next()).value
          if (validateSequence === false) {
            assert.deepStrictEqual(next?.message, gap)
            assert.deepStrictEqual(errors, [])
          } else {
            assert.strictEqual(next, undefined)
            assert.strictEqual(errors.length, 1)
            assert.ok(errors[0] instanceof SequenceGapError)
            assert.strictEqual(errors[0].key, `${instType}:books:${symbol}`)
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
      }
    )
  }
}
