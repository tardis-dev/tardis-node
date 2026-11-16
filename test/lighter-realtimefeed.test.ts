import { test } from 'node:test'
import { stream, SequenceGapError } from '../dist/index.js'
import { createTestWebSocketServer } from './helpers/websocket.ts'
import { assert, errorMessageIncludes } from './assertions.ts'
import { LighterRealTimeFeed } from '../dist/realtimefeeds/lighter.js'
import { getRealTimeFeedFactory } from '../dist/realtimefeeds/index.js'
import type { Filter } from '../dist/types.js'

class TestLighterRealTimeFeed extends LighterRealTimeFeed {
  defaultURL() {
    return this.wssURL
  }

  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }
}

test('register lighter realtime feed', () => {
  assert.ok(getRealTimeFeedFactory('lighter'))
})

test('use the correct lighter realtime endpoint', () => {
  const feed = new TestLighterRealTimeFeed('lighter', [], undefined)

  assert.strictEqual(feed.defaultURL(), 'wss://mainnet.zklighter.elliot.ai/stream')
})

test('map lighter realtime subscriptions', () => {
  const expected = [
    { type: 'subscribe', channel: 'order_book/0' },
    { type: 'subscribe', channel: 'trade/0' },
    { type: 'subscribe', channel: 'ticker/0' },
    { type: 'subscribe', channel: 'market_stats/all' },
    { type: 'subscribe', channel: 'spot_market_stats/all' }
  ]
  const filters = [
    { channel: 'order_book', symbols: ['0'] },
    { channel: 'trade', symbols: ['0'] },
    { channel: 'ticker', symbols: ['0'] },
    { channel: 'market_stats' },
    { channel: 'spot_market_stats' }
  ]

  assert.deepStrictEqual(new TestLighterRealTimeFeed('lighter', [], undefined).map(filters), expected)
})

test('lighter realtime subscriptions require symbols for per-market channels', () => {
  const feed = new TestLighterRealTimeFeed('lighter', [], undefined)

  assert.throws(
    () => feed.map([{ channel: 'order_book' }]),
    errorMessageIncludes('lighter RealTimeFeed requires explicitly specified symbols when subscribing to live feed')
  )
})

function book(nonce: number, begin_nonce: number, type = 'update/order_book', market = '1') {
  return {
    type,
    channel: `order_book:${market}`,
    timestamp: Date.now(),
    last_updated_at: Date.now() * 1000,
    offset: nonce,
    order_book: {
      nonce,
      begin_nonce,
      offset: nonce,
      last_updated_at: Date.now() * 1000,
      code: 0,
      bids: [{ price: '100', size: String(nonce) }],
      asks: []
    }
  }
}

for (const exchange of ['lighter', 'lighter-rh'] as const) {
  for (const validateSequence of [true, false]) {
    test(
      `${exchange} continuity, resets and channel isolation: validation=${validateSequence ?? 'default'}`,
      { timeout: 10000 },
      async () => {
        const errors: Error[] = []
        const empty = book(120, 110)
        empty.order_book.bids = []
        const valid = [
          { type: 'connected', session_id: 'test' },
          book(100, 999, 'subscribed/order_book'),
          book(110, 100),
          book(110, 100),
          book(500, 0, 'subscribed/order_book', '2050'),
          { type: 'update/ticker', channel: 'ticker:1', nonce: 999999, ticker: { s: '1' } },
          { type: 'update/trade', channel: 'trade:1', nonce: 999999, trades: [] },
          { type: 'update/market_stats', channel: 'market_stats:all', market_stats: {} },
          empty,
          book(130, 120),
          book(0, 999, 'subscribed/order_book'),
          book(1, 0),
          book(510, 500, 'update/order_book', '2050')
        ]
        const gap = book(3, 2)
        const { server, cleanup } = await createTestWebSocketServer(exchange)
        let subscription: unknown
        server.on('connection', (socket) =>
          socket.once('message', (bytes) => {
            subscription = JSON.parse(bytes.toString())
            for (const message of [...valid, gap]) socket.send(JSON.stringify(message))
          })
        )
        const feed = stream({
          exchange,
          filters: [{ channel: 'order_book', symbols: ['1'] }],
          timeoutIntervalMS: 0,
          validateSequence,
          withDisconnects: true,
          onError: (error) => errors.push(error)
        })
        try {
          for (const message of valid) assert.deepStrictEqual((await feed.next()).value?.message, message)
          assert.deepStrictEqual(subscription, { type: 'subscribe', channel: 'order_book/1' })
          const next = (await feed.next()).value
          if (validateSequence === false) {
            assert.deepStrictEqual(next?.message, gap)
            assert.deepStrictEqual(errors, [])
          } else {
            assert.strictEqual(next, undefined)
            assert.strictEqual(errors.length, 1)
            assert.ok(errors[0] instanceof SequenceGapError)
            assert.strictEqual(errors[0].exchange, exchange)
            assert.strictEqual(errors[0].key, 'order_book:1')
            assert.strictEqual(errors[0].expectedPreviousSequence, 1)
            assert.strictEqual(errors[0].previousSequence, 2)
            assert.strictEqual(errors[0].sequence, 3)
          }
        } finally {
          await feed.return?.()
          await cleanup()
        }
      }
    )
  }
}
