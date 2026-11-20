import { test } from 'node:test'
import { stream, streamNormalized, normalizeBookChanges, normalizeTrades, normalizeBookTickers, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

for (const authenticated of [false, true]) {
  for (const validateSequence of [undefined, false]) {
    test(`Coinbase full: authenticated=${authenticated}, validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
      const event = (type: string, sequence?: number, product_id = 'BTC-USD') => ({
        type,
        product_id,
        ...(sequence === undefined ? {} : { sequence })
      })
      const valid = [
        event('received', 100),
        event('received', 900, 'ETH-USD'),
        event('open', 101),
        event('match', 102),
        event('change', 103),
        event('done', 104),
        event('heartbeat', 104),
        ...(authenticated ? [{ ...event('open', 104), user_id: 'local-test-user', profile_id: 'local-test-profile' }] : []),
        event('ticker', 10000),
        event('snapshot', 10001),
        event('l2update', 10002),
        event('auction', 10003),
        event('last_auction', 10004),
        event('rfq_match', 10005),
        event('open', undefined),
        event('received', 10, 'ETH-EUR'),
        event('open', 20, 'ETH-EUR'),
        event('activate', 105),
        event('new_full_event', 106),
        event('open', 901, 'ETH-USD')
      ]
      const gap = event('done', 108)
      const credentials = {
        COINBASE_API_KEY: process.env.COINBASE_API_KEY,
        COINBASE_API_SECRET: process.env.COINBASE_API_SECRET,
        COINBASE_API_PASSPHRASE: process.env.COINBASE_API_PASSPHRASE
      }
      if (authenticated) {
        process.env.COINBASE_API_KEY = 'local-test-key'
        process.env.COINBASE_API_SECRET = Buffer.from('local-test-secret').toString('base64')
        process.env.COINBASE_API_PASSPHRASE = 'local-test-passphrase'
      } else {
        for (const name of Object.keys(credentials)) delete process.env[name]
      }
      const errors: Error[] = []
      const { server, cleanup } = await createTestWebSocketServer('coinbase')
      server.on('connection', (socket) =>
        socket.once('message', (bytes) => {
          const subscription = JSON.parse(bytes.toString())
          assert.strictEqual(subscription.type, 'subscribe')
          // Preserve the existing subscription mapping: requesting full selects full for all requested products.
          assert.deepStrictEqual(subscription.channels, [{ name: 'full', product_ids: ['ETH-USD', 'BTC-USD'] }])
          assert.strictEqual(subscription.key, authenticated ? 'local-test-key' : undefined)
          for (const message of valid) socket.send(JSON.stringify(message))
          socket.send(JSON.stringify(gap))
        })
      )
      const messages = stream({
        exchange: 'coinbase',
        filters: [
          { channel: 'received', symbols: ['BTC-USD'] },
          { channel: 'match', symbols: ['ETH-USD'] }
        ],
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
          assert.strictEqual(errors[0].exchange, 'coinbase')
          assert.strictEqual(errors[0].key, 'BTC-USD')
          assert.strictEqual(errors[0].expectedPreviousSequence, 106)
          assert.strictEqual(errors[0].previousSequence, 107)
          assert.strictEqual(errors[0].sequence, 108)
        }
      } finally {
        try {
          await messages.return?.()
        } finally {
          try {
            await cleanup()
          } finally {
            for (const [name, value] of Object.entries(credentials)) {
              if (value === undefined) delete process.env[name]
              else process.env[name] = value
            }
          }
        }
      }
    })
  }
}

for (const withDisconnects of [false, true]) {
  test(`Coinbase full: reconnects with fresh counters (disconnects=${withDisconnects})`, { timeout: 10000 }, async () => {
    const event = (sequence: number) => ({ type: 'open', product_id: 'BTC-USD', sequence })
    let connections = 0
    const errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('coinbase')
    server.on('connection', (socket) => {
      const first = ++connections === 1
      socket.once('message', (bytes) => {
        assert.deepStrictEqual(JSON.parse(bytes.toString()).channels, [{ name: 'full', product_ids: ['BTC-USD'] }])
        for (const sequence of first ? [100, 102] : [1, 2]) socket.send(JSON.stringify(event(sequence)))
      })
    })
    const messages = stream({
      exchange: 'coinbase',
      filters: [{ channel: 'open', symbols: ['BTC-USD'] }],
      timeoutIntervalMS: 0,
      withDisconnects,
      onError: (error) => errors.push(error)
    })
    try {
      assert.deepStrictEqual((await messages.next()).value?.message, event(100))
      if (withDisconnects) assert.strictEqual((await messages.next()).value, undefined)
      assert.deepStrictEqual((await messages.next()).value?.message, event(1))
      assert.deepStrictEqual((await messages.next()).value?.message, event(2))
      assert.strictEqual(errors.length, 1)
      assert.ok(errors[0] instanceof SequenceGapError)
      assert.strictEqual(connections, 2)
    } finally {
      try {
        await messages.return?.()
      } finally {
        await cleanup()
      }
    }
  })
}

test('Coinbase partial subscriptions preserve sparse matches and ticker sequences', { timeout: 10000 }, async () => {
  const event = (type: string, sequence: number) => ({ type, product_id: 'BTC-USD', sequence })
  const valid = [event('last_match', 100), event('match', 200), event('ticker', 201), event('match', 300), event('ticker', 500)]
  const { server, cleanup } = await createTestWebSocketServer('coinbase')
  server.on('connection', (socket) =>
    socket.once('message', (bytes) => {
      assert.deepStrictEqual(JSON.parse(bytes.toString()).channels, [
        {
          name:
            process.env.COINBASE_API_KEY && process.env.COINBASE_API_SECRET && process.env.COINBASE_API_PASSPHRASE
              ? 'level2'
              : 'level2_batch',
          product_ids: ['BTC-USD']
        },
        { name: 'matches', product_ids: ['BTC-USD'] },
        { name: 'ticker', product_ids: ['BTC-USD'] }
      ])
      for (const message of valid) socket.send(JSON.stringify(message))
    })
  )
  const messages = stream({
    exchange: 'coinbase',
    filters: (['match', 'snapshot', 'l2update', 'ticker'] as const).map((channel) => ({ channel, symbols: ['BTC-USD'] }) as const),
    timeoutIntervalMS: 0,
    validateSequence: true,
    onError: (error) => assert.fail(error.message)
  })
  try {
    for (const message of valid) assert.deepStrictEqual((await messages.next()).value.message, message)
  } finally {
    try {
      await messages.return?.()
    } finally {
      await cleanup()
    }
  }
})

for (const validateSequence of [undefined, false]) {
  test(`Coinbase normalized partial feed: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const trade = (sequence: number, type = 'match') => ({
      type,
      product_id: 'BTC-USD',
      sequence,
      trade_id: sequence,
      time: '2026-11-05T14:00:00.123456Z',
      price: '100',
      size: '2',
      side: 'sell'
    })
    const { server, cleanup } = await createTestWebSocketServer('coinbase')
    server.on('connection', (socket) =>
      socket.once('message', (bytes) => {
        const subscription = JSON.parse(bytes.toString())
        assert.ok(subscription.channels.every((channel: { name: string }) => channel.name !== 'full'))
        for (const message of [
          trade(100, 'last_match'),
          { type: 'snapshot', product_id: 'BTC-USD', bids: [['99', '1']], asks: [['101', '1']] },
          trade(200),
          { type: 'l2update', product_id: 'BTC-USD', time: '2026-11-05T14:00:00.123456Z', changes: [['buy', '99', '2']] },
          { ...trade(201, 'ticker'), best_bid: '99', best_ask: '101' },
          trade(900)
        ])
          socket.send(JSON.stringify(message))
      })
    )
    const messages = streamNormalized(
      {
        exchange: 'coinbase',
        symbols: ['BTC-USD'],
        timeoutIntervalMS: 0,
        validateSequence,
        onError: (error) => assert.fail(error.message)
      },
      normalizeBookChanges,
      normalizeTrades,
      normalizeBookTickers
    )
    try {
      const snapshot = (await messages.next()).value
      assert.ok(snapshot.type === 'book_change' && snapshot.isSnapshot)
      assert.strictEqual((await messages.next()).value.type, 'trade')
      const update = (await messages.next()).value
      assert.ok(update.type === 'book_change' && !update.isSnapshot)
      assert.deepStrictEqual(update.bids, [{ price: 99, amount: 2 }])
      assert.strictEqual((await messages.next()).value.type, 'book_ticker')
      const lastTrade = (await messages.next()).value
      assert.ok(lastTrade.type === 'trade' && lastTrade.id === '900')
    } finally {
      try {
        await messages.return?.()
      } finally {
        await cleanup()
      }
    }
  })
}
