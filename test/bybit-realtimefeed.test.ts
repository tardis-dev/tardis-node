import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import type { WebSocket } from 'ws'
import { stream, streamNormalized, normalizeBookChanges, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

for (const [exchange, symbol, channel] of [
  ['bybit', 'BTCUSDT', 'orderbook.50'],
  ['bybit-spot', 'BTCUSDT', 'orderbook.50'],
  ['bybit-options', 'BTC-6NOV26-80000-C-USDT', 'orderbook.25'],
  ['bybit-spread', 'BTCUSDT-06NOV26_BTCUSDT', 'orderbook.25']
] as const) {
  for (const withDisconnectMessages of [false, true]) {
    test(
      `${exchange}: normalized books recover with a fresh snapshot (disconnect messages=${withDisconnectMessages})`,
      { timeout: 10000 },
      async () => {
        const book = (u: number, type: 'snapshot' | 'delta' = 'delta') => ({
          topic: `${channel}.${symbol}`,
          type,
          ts: 1793786400000,
          data: { s: symbol, u, seq: u * 100, b: [['100', String(u)]], a: [] }
        })
        const errors: Error[] = []
        let connections = 0
        const { server, cleanup } = await createTestWebSocketServer(exchange)
        server.on('connection', (socket) => {
          const first = ++connections === 1
          socket.once('message', () => {
            for (const message of first ? [book(10, 'snapshot'), book(11), book(13)] : [book(100, 'snapshot'), book(101)]) {
              socket.send(JSON.stringify(message))
            }
          })
        })
        const messages = streamNormalized(
          {
            exchange,
            symbols: [symbol],
            timeoutIntervalMS: 0,
            withDisconnectMessages,
            onError: (error) => errors.push(error)
          },
          normalizeBookChanges
        )
        try {
          for (const [isSnapshot, amount] of [
            [true, 10],
            [false, 11]
          ] as const) {
            const message = (await messages.next()).value
            assert.ok(message.type === 'book_change' && message.isSnapshot === isSnapshot)
            assert.deepStrictEqual(message.bids, [{ price: 100, amount }])
          }
          if (withDisconnectMessages) assert.strictEqual((await messages.next()).value.type, 'disconnect')
          for (const [isSnapshot, amount] of [
            [true, 100],
            [false, 101]
          ] as const) {
            const message = (await messages.next()).value
            assert.ok(message.type === 'book_change' && message.isSnapshot === isSnapshot)
            assert.deepStrictEqual(message.bids, [{ price: 100, amount }])
          }
          assert.strictEqual(connections, 2)
          assert.strictEqual(errors.length, 1)
          assert.ok(errors[0] instanceof SequenceGapError)
          assert.strictEqual(errors[0].expectedPreviousSequence, 11)
          assert.strictEqual(errors[0].previousSequence, 12)
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

for (const [exchange, symbol, channel] of [
  ['bybit', 'BTCUSDT', 'orderbook.50'],
  ['bybit', 'BTCUSD', 'orderbook.50'],
  ['bybit', 'BTCPERP', 'orderbook.50'],
  ['bybit-spot', 'BTCUSDT', 'orderbook.50'],
  ['bybit-options', 'BTC-6NOV26-80000-C-USDT', 'orderbook.25'],
  ['bybit-spread', 'BTCUSDT-06NOV26_BTCUSDT', 'orderbook.25']
] as const) {
  for (const validateSequence of [undefined, false]) {
    test(
      `${exchange} ${symbol}: sequence validation ${validateSequence === false ? 'disabled' : 'default'}`,
      { timeout: 10000 },
      async () => {
        const book = (u: number, type: 'snapshot' | 'delta' = 'delta', depth = channel) => ({
          topic: `${depth}.${symbol}`,
          type,
          ts: 1793786400000,
          data: { s: symbol, u, seq: u * 100, b: [['100', '1']], a: [['101', '1']] }
        })
        const valid = [book(100, 'snapshot'), book(101), book(500, 'snapshot'), book(501), book(1), book(2), { op: 'pong' }]
        const gap = book(4)
        const errors: Error[] = []
        const { server, cleanup } = await createTestWebSocketServer(exchange)
        server.on('connection', (socket) => {
          socket.on('message', (bytes) => {
            const subscription = JSON.parse(bytes.toString())
            assert.deepStrictEqual(subscription, { op: 'subscribe', args: [`${channel}.${symbol}`] })
            for (const message of [{ op: 'subscribe', success: true }, ...valid, gap]) socket.send(JSON.stringify(message))
          })
        })
        const messages = stream({
          exchange,
          filters: [{ channel, symbols: [symbol] }],
          timeoutIntervalMS: 0,
          validateSequence,
          withDisconnects: true,
          onError: (error) => errors.push(error)
        })
        try {
          await messages.next()
          for (const message of valid) assert.deepStrictEqual((await messages.next()).value?.message, message)
          const next = (await messages.next()).value
          if (validateSequence === false) {
            assert.deepStrictEqual(next?.message, gap)
            assert.deepStrictEqual(errors, [])
          } else {
            assert.strictEqual(next, undefined)
            assert.strictEqual(errors.length, 1)
            assert.ok(errors[0] instanceof SequenceGapError)
            assert.strictEqual(errors[0].key, `${channel}.${symbol}`)
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

for (const exchange of ['bybit', 'bybit-spot'] as const) {
  for (const [channel, last] of [
    ['orderbook.full', 102],
    ['orderbook.50', 52]
  ] as const) {
    test(`${exchange}: ${channel} keeps full and bounded sequence domains separate`, { timeout: 10000 }, async () => {
      const book = (topic: string, u: number, type: 'snapshot' | 'delta' = 'delta') => ({
        topic: `${topic}.BTCUSDT`,
        type,
        ts: 1793786400000,
        data: { s: 'BTCUSDT', u, seq: u * 1000, b: [['100', '1']], a: [] }
      })
      const valid = [
        book('orderbook.50', 50, 'snapshot'),
        book('orderbook.full', 100),
        book('orderbook.50', 51),
        book('orderbook.full', 101),
        { ...book('orderbook.full', 1, 'snapshot'), generated: true }
      ]
      const errors: Error[] = []
      const { server, cleanup } = await createTestWebSocketServer(exchange)
      server.on('connection', (socket) =>
        socket.once('message', () => {
          for (const message of [...valid, book(channel, last + 1)]) socket.send(JSON.stringify(message))
        })
      )
      const messages = stream({
        exchange,
        filters: [
          { channel: 'orderbook.50', symbols: ['BTCUSDT'] },
          { channel: 'orderbook.full', symbols: ['BTCUSDT'] }
        ],
        timeoutIntervalMS: 0,
        withDisconnects: true,
        onError: (error) => errors.push(error)
      })
      try {
        for (const message of valid) assert.deepStrictEqual((await messages.next()).value?.message, message)
        assert.strictEqual((await messages.next()).value, undefined)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
        assert.strictEqual(errors[0].key, channel === 'orderbook.full' ? 'BTCUSDT' : 'orderbook.50.BTCUSDT')
        assert.strictEqual(errors[0].expectedPreviousSequence, last - 1)
        assert.strictEqual(errors[0].previousSequence, last)
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

for (const validateSequence of [undefined, false]) {
  test(
    `Bybit full book u=1 ${validateSequence === false ? 'passes with opt-out' : 'restarts both connections'}`,
    { timeout: 10000 },
    async () => {
      const book = (symbol: string, u: number) => ({
        topic: `orderbook.full.${symbol}`,
        type: 'delta',
        ts: 1793786400000,
        data: { s: symbol, u, seq: u * 1000, b: [['100', '1']], a: [] }
      })
      const connections: { socket: WebSocket; symbol?: string }[] = []
      const errors: Error[] = []
      const { server, cleanup } = await createTestWebSocketServer('bybit')
      server.on('connection', (socket) => {
        const initial = connections.length < 2
        const connection: { socket: WebSocket; symbol?: string } = { socket }
        connections.push(connection)
        socket.once('message', (bytes) => {
          const symbol = JSON.parse(bytes.toString()).args[0].split('.').slice(2).join('.')
          connection.symbol = symbol
          socket.send(JSON.stringify(book(symbol, initial ? 100 : 1)))
        })
      })
      const messages = stream({
        exchange: 'bybit',
        filters: [{ channel: 'orderbook.full', symbols: ['BTCUSDT', 'BTCUSD'] }],
        timeoutIntervalMS: 0,
        validateSequence,
        withDisconnects: true,
        onError: (error) => errors.push(error)
      })
      try {
        const initial = [(await messages.next()).value, (await messages.next()).value]
        assert.deepStrictEqual(new Set(initial.map((item) => item?.message.data.s)), new Set(['BTCUSDT', 'BTCUSD']))
        const reset = book('BTCUSDT', 1)
        connections.find(({ symbol }) => symbol === 'BTCUSDT')!.socket.send(JSON.stringify(reset))
        const next = (await messages.next()).value
        if (validateSequence === false) {
          assert.deepStrictEqual(next?.message, reset)
          assert.deepStrictEqual(errors, [])
        } else {
          assert.strictEqual(next, undefined)
          const recovered = [(await messages.next()).value, (await messages.next()).value]
          assert.deepStrictEqual(new Set(recovered.map((item) => item?.message.data.s)), new Set(['BTCUSDT', 'BTCUSD']))
          assert.ok(recovered.every((item) => item?.message.data.u === 1))
          for (let attempt = 0; attempt < 200 && connections.slice(0, 2).some(({ socket }) => socket.readyState !== 3); attempt++)
            await sleep(10)
          assert.ok(connections.slice(0, 2).every(({ socket }) => socket.readyState === 3))
          assert.strictEqual(connections.length, 4)
          assert.strictEqual(errors.length, 1)
          assert.ok(errors[0] instanceof SequenceGapError)
          assert.strictEqual(errors[0].key, 'BTCUSDT')
          assert.strictEqual(errors[0].expectedPreviousSequence, 100)
          assert.strictEqual(errors[0].previousSequence, 0)
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

test('Bybit spot: raw gap recovery hides disconnects by default', { timeout: 10000 }, async () => {
  const book = (u: number) => ({
    topic: 'orderbook.50.BTCUSDT',
    type: 'snapshot',
    ts: 1793786400000,
    data: { s: 'BTCUSDT', u, seq: u * 100, b: [['100', '1']], a: [] }
  })
  let connections = 0
  const errors: Error[] = []
  const { server, cleanup } = await createTestWebSocketServer('bybit-spot')
  server.on('connection', (socket) => {
    const first = ++connections === 1
    socket.once('message', () => {
      socket.send(JSON.stringify(book(first ? 10 : 100)))
      if (first) socket.send(JSON.stringify({ ...book(12), type: 'delta' }))
    })
  })
  const messages = stream({
    exchange: 'bybit-spot',
    filters: [{ channel: 'orderbook.50', symbols: ['BTCUSDT'] }],
    timeoutIntervalMS: 0,
    onError: (error) => errors.push(error)
  })
  try {
    assert.deepStrictEqual((await messages.next()).value.message, book(10))
    assert.deepStrictEqual((await messages.next()).value.message, book(100))
    assert.strictEqual(connections, 2)
    assert.strictEqual(errors.length, 1)
    assert.ok(errors[0] instanceof SequenceGapError)
    assert.strictEqual(errors[0].expectedPreviousSequence, 10)
    assert.strictEqual(errors[0].previousSequence, 11)
  } finally {
    try {
      await messages.return?.()
    } finally {
      await cleanup()
    }
  }
})

test('Bybit spot: normalized opt-out passes discontinuous updates', { timeout: 10000 }, async () => {
  const book = (u: number, type: 'snapshot' | 'delta') => ({
    topic: 'orderbook.50.BTCUSDT',
    type,
    ts: 1793786400000,
    data: { s: 'BTCUSDT', u, seq: u * 100, b: [['100', String(u)]], a: [] }
  })
  const { server, cleanup } = await createTestWebSocketServer('bybit-spot')
  server.on('connection', (socket) =>
    socket.once('message', () => {
      socket.send(JSON.stringify(book(1, 'snapshot')))
      socket.send(JSON.stringify(book(3, 'delta')))
    })
  )
  const messages = streamNormalized(
    {
      exchange: 'bybit-spot',
      symbols: ['BTCUSDT'],
      timeoutIntervalMS: 0,
      validateSequence: false,
      onError: (error) => assert.fail(error.message)
    },
    normalizeBookChanges
  )
  try {
    const snapshot = (await messages.next()).value
    assert.ok(snapshot.type === 'book_change' && snapshot.isSnapshot)
    const update = (await messages.next()).value
    assert.ok(update.type === 'book_change' && !update.isSnapshot)
    assert.deepStrictEqual(update.bids, [{ price: 100, amount: 3 }])
  } finally {
    try {
      await messages.return?.()
    } finally {
      await cleanup()
    }
  }
})
