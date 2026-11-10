import { test } from 'node:test'
import { stream, streamNormalized, normalizeBookChanges, SequenceGapError } from '../dist/index.js'
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

for (const validateSequence of [undefined, true, false]) {
  test(`Lighter continuity, resets and channel isolation: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
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
    const { server, cleanup } = await createTestWebSocketServer('lighter')
    let subscription: unknown
    server.on('connection', (socket) =>
      socket.once('message', (bytes) => {
        subscription = JSON.parse(bytes.toString())
        for (const message of [...valid, gap]) socket.send(JSON.stringify(message))
      })
    )
    const feed = stream({
      exchange: 'lighter',
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
        assert.strictEqual(errors[0].exchange, 'lighter')
        assert.strictEqual(errors[0].key, 'order_book:1')
        assert.strictEqual(errors[0].expectedPreviousSequence, 1)
        assert.strictEqual(errors[0].previousSequence, 2)
        assert.strictEqual(errors[0].sequence, 3)
      }
    } finally {
      await feed.return?.()
      await cleanup()
    }
  })
}

for (const normalized of [false, true]) {
  for (const withDisconnects of [false, true]) {
    test(`Lighter sequence recovery: normalized=${normalized}, disconnects=${withDisconnects}`, { timeout: 10000 }, async () => {
      const errors: Error[] = []
      let connections = 0
      const initial = [book(100, 0, 'subscribed/order_book'), book(110, 100), book(130, 120)]
      const recovered = [book(1, 999, 'subscribed/order_book'), book(2, 1)]
      const { server, cleanup } = await createTestWebSocketServer('lighter')
      server.on('connection', (socket) => {
        const first = ++connections === 1
        socket.once('message', () => {
          for (const message of first ? initial : recovered) socket.send(JSON.stringify(message))
        })
      })
      const options = { exchange: 'lighter' as const, timeoutIntervalMS: 0, onError: (error: Error) => errors.push(error) }
      const feed = normalized
        ? streamNormalized({ ...options, symbols: ['1'], withDisconnectMessages: withDisconnects }, normalizeBookChanges)
        : stream({ ...options, filters: [{ channel: 'order_book', symbols: ['1'] }], withDisconnects })
      const output: any[] = []
      try {
        for await (const message of feed) {
          output.push(message)
          if (output.length === (withDisconnects ? 5 : 4)) break
        }
        if (withDisconnects) {
          assert.strictEqual(normalized ? output[2].type : output[2], normalized ? 'disconnect' : undefined)
          output.splice(2, 1)
        }
        if (normalized) {
          assert.deepStrictEqual(
            output.map((message) => message.isSnapshot),
            [true, false, true, false]
          )
          assert.deepStrictEqual(
            output.map((message) => message.bids),
            [100, 110, 1, 2].map((amount) => [{ price: 100, amount }])
          )
        } else
          assert.deepStrictEqual(
            output.map((message) => message.message),
            [...initial.slice(0, 2), ...recovered]
          )
        assert.strictEqual(connections, 2)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
      } finally {
        await feed.return?.()
        await cleanup()
      }
    })
  }
}

test('Lighter normalized opt-out preserves book mapping across a gap', { timeout: 10000 }, async () => {
  const errors: Error[] = []
  const { server, cleanup } = await createTestWebSocketServer('lighter')
  server.on('connection', (socket) =>
    socket.once('message', () => {
      for (const message of [book(100, 0, 'subscribed/order_book'), book(110, 100), book(130, 120)]) socket.send(JSON.stringify(message))
    })
  )
  const feed = streamNormalized(
    { exchange: 'lighter', symbols: ['1'], timeoutIntervalMS: 0, validateSequence: false, onError: (error) => errors.push(error) },
    normalizeBookChanges
  )
  try {
    for (const amount of [100, 110, 130]) assert.deepStrictEqual((await feed.next()).value.bids, [{ price: 100, amount }])
    assert.deepStrictEqual(errors, [])
  } finally {
    await feed.return?.()
    await cleanup()
  }
})

test('Lighter migration leaves lighter-rh validation unchanged', { timeout: 10000 }, async () => {
  const native = [book(100, 0, 'subscribed/order_book'), book(130, 120)]
  const errors: Error[] = []
  const { server, cleanup } = await createTestWebSocketServer('lighter-rh')
  server.on('connection', (socket) =>
    socket.once('message', () => {
      for (const message of native) socket.send(JSON.stringify(message))
    })
  )
  const feed = stream({
    exchange: 'lighter-rh',
    filters: [{ channel: 'order_book', symbols: ['1'] }],
    timeoutIntervalMS: 0,
    onError: (error) => errors.push(error)
  })
  try {
    for (const message of native) assert.deepStrictEqual((await feed.next()).value.message, message)
    assert.deepStrictEqual(errors, [])
  } finally {
    await feed.return?.()
    await cleanup()
  }
})
