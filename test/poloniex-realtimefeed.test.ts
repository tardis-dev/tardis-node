import { test } from 'node:test'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'
import { SequenceGapError, stream } from '../dist/index.js'

for (const validateSequence of [true, false]) {
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
