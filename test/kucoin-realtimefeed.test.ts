import { test } from 'node:test'
import { stream, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

function update(sequenceStart: number, sequenceEnd: number, symbol = 'BTC-USDT') {
  return {
    type: 'message',
    topic: `/market/level2:${symbol}`,
    subject: 'trade.l2update',
    data: {
      symbol,
      sequenceStart,
      sequenceEnd,
      time: Date.now(),
      changes: { bids: [['100', String(sequenceEnd), String(sequenceEnd)]], asks: [] }
    }
  }
}
function snapshot(sequence: number) {
  return {
    type: 'message',
    generated: true,
    topic: '/market/level2Snapshot:BTC-USDT',
    subject: 'trade.l2Snapshot',
    code: '200000',
    data: { time: Date.now(), sequence: String(sequence), bids: [['100', String(sequence)]], asks: [] }
  }
}

for (const validateSequence of [true, false]) {
  test(`KuCoin range continuity and symbol isolation: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async (context) => {
    const errors: Error[] = []
    const { server, wssURL, cleanup } = await createTestWebSocketServer()
    context.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
      assert.strictEqual(String(url), 'https://api.kucoin.com/api/v1/bullet-public')
      assert.strictEqual(options?.method, 'POST')
      return Response.json({ data: { token: 'test', instanceServers: [{ endpoint: wssURL }] } })
    })
    const empty = update(111, 115)
    empty.data.changes.bids = []
    const valid = [
      { type: 'welcome', id: 'test' },
      { type: 'ack', id: 'test' },
      { type: 'pong', id: 'test' },
      update(100, 105),
      update(106, 110),
      update(106, 110),
      update(500, 501, 'ETH-USDT'),
      snapshot(50),
      { type: 'message', subject: 'trade.l3match', data: { symbol: 'BTC-USDT', sequenceStart: 9999, sequenceEnd: 10000 } },
      { type: 'message', subject: 'trade.ticker', data: { symbol: 'BTC-USDT', sequenceStart: 9999, sequenceEnd: 10000 } },
      empty, // Empty updates still advance the range.
      update(502, 505, 'ETH-USDT')
    ]
    const gap = update(117, 120)
    server.on('connection', (socket) =>
      socket.once('message', (bytes) => {
        const subscription = JSON.parse(bytes.toString())
        assert.strictEqual(subscription.topic, '/market/level2:BTC-USDT,ETH-USDT')
        for (const message of [...valid, gap]) socket.send(JSON.stringify(message))
      })
    )
    const feed = stream({
      exchange: 'kucoin',
      filters: [{ channel: 'market/level2', symbols: ['BTC-USDT', 'ETH-USDT'] }],
      timeoutIntervalMS: 0,
      validateSequence,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })
    try {
      for (const message of valid) assert.deepStrictEqual((await feed.next()).value?.message, message)
      const next = (await feed.next()).value
      if (validateSequence === false) {
        assert.deepStrictEqual(next?.message, gap)
        assert.deepStrictEqual(errors, [])
      } else {
        assert.strictEqual(next, undefined)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
        assert.strictEqual(errors[0].exchange, 'kucoin')
        assert.strictEqual(errors[0].key, 'BTC-USDT')
        assert.strictEqual(errors[0].expectedPreviousSequence, 115)
        assert.strictEqual(errors[0].previousSequence, 116)
        assert.strictEqual(errors[0].sequence, 120)
      }
    } finally {
      await feed.return?.()
      await cleanup()
    }
  })
}
