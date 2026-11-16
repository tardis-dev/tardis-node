import { test } from 'node:test'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'
import { SequenceGapError, stream } from '../dist/index.js'

for (const validateSequence of [true, false]) {
  test(`WOO X depth continuity: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const depth = (ts: number, prevTs: number, s = 'SPOT_BTC_USDT') => ({
      topic: `orderbookupdate@${s}@50`,
      ts: 999999,
      data: { s, ts, prevTs, bids: [], asks: [] }
    })
    const native = [
      { id: 'SPOT_BTC_USDT', cmd: 'SUBSCRIBE', success: true },
      { cmd: 'PING' },
      depth(100, 99),
      depth(105, 100),
      depth(105, 100),
      depth(110, 105),
      depth(500, 499, 'PERP_BTC_USDT'),
      depth(505, 500, 'PERP_BTC_USDT'),
      { topic: 'orderbook@SPOT_BTC_USDT@50', generated: true, ts: 90, data: { bids: [], asks: [] } },
      { ...depth(9999, 9998), topic: 'bbo@SPOT_BTC_USDT' },
      depth(115, 110)
    ]
    const gap = depth(120, 119),
      errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('woo-x')
    server.on('connection', (socket) =>
      socket.once('message', (bytes) => {
        assert.deepStrictEqual(JSON.parse(bytes.toString()), {
          id: 'PERP_BTC_USDT',
          cmd: 'subscribe',
          params: ['orderbookupdate@PERP_BTC_USDT@50']
        })
        for (const message of [...native, gap]) socket.send(JSON.stringify(message))
      })
    )
    const messages = stream({
      exchange: 'woo-x',
      filters: [{ channel: 'orderbookupdate', symbols: ['SPOT_BTC_USDT', 'PERP_BTC_USDT'] }],
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
        assert.strictEqual(errors[0].exchange, 'woo-x')
        assert.strictEqual(errors[0].key, 'SPOT_BTC_USDT')
        assert.strictEqual(errors[0].expectedPreviousSequence, 115)
        assert.strictEqual(errors[0].previousSequence, 119)
        assert.strictEqual(errors[0].sequence, 120)
      }
    } finally {
      await messages.return?.()
      await cleanup()
    }
  })
}
