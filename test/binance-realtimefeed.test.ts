import { test } from 'node:test'
import type { WebSocket } from 'ws'
import { setTimeout as sleep } from 'node:timers/promises'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'
import { stream, SequenceGapError } from '../dist/index.js'

test('Binance futures replay-only channels do not subscribe or disrupt supported streams', { timeout: 10_000 }, async () => {
  const { server, cleanup } = await createTestWebSocketServer('binance-futures')
  const subscriptions: unknown[] = []
  const message = { stream: 'btcusdt@trade', data: { s: 'BTCUSDT', p: '100', q: '1' } }
  server.on('connection', (socket) => {
    socket.on('message', (payload) => {
      subscriptions.push(JSON.parse(payload.toString()))
      socket.send(JSON.stringify(message))
    })
  })

  const messages = stream({
    exchange: 'binance-futures',
    filters: [{ channel: 'fundingRate', symbols: ['btcusdt'] }, { channel: 'tradingSession' }, { channel: 'trade', symbols: ['btcusdt'] }]
  })

  try {
    assert.deepEqual((await messages.next()).value?.message, message)
    assert.deepEqual(subscriptions, [{ method: 'SUBSCRIBE', params: ['btcusdt@trade'], id: 1 }])
  } finally {
    try {
      await messages.return?.()
    } finally {
      await cleanup()
    }
  }
})

test('Binance futures streaming ends without data when only replay-only channels are requested', { timeout: 10_000 }, async () => {
  const messages = stream({
    exchange: 'binance-futures',
    filters: [{ channel: 'fundingRate' }, { channel: 'tradingSession' }]
  })

  try {
    assert.deepEqual(await messages.next(), { done: true, value: undefined })
  } finally {
    await messages.return?.()
  }
})

for (const exchangeId of ['binance', 'binance-us', 'binance-futures', 'binance-delivery'] as const) {
  for (const validateSequence of [undefined, false]) {
    test(`${exchangeId}: sequence validation ${validateSequence === false ? 'disabled' : 'default'}`, { timeout: 10000 }, async () => {
      const spot = exchangeId === 'binance' || exchangeId === 'binance-us'
      const depth = (u: number, previous: number, symbol = 'BTCUSDT', U = u) => ({
        stream: `${symbol.toLowerCase()}@depth@${spot ? '100ms' : '0ms'}`,
        data: {
          e: 'depthUpdate',
          E: 1793786400000,
          T: 1793786400000,
          s: symbol,
          U: spot ? previous + 1 : U,
          u,
          ...(spot ? {} : { pu: previous }),
          b: [['100', String(u)]],
          a: []
        }
      })

      const errors: Error[] = []
      const valid = [depth(100, 80), depth(110, 100, 'BTCUSDT', 105)]
      const gap = depth(140, 130)

      const { server, cleanup } = await createTestWebSocketServer(exchangeId)
      server.on('connection', (socket) => {
        socket.on('message', (bytes) => {
          const { id } = JSON.parse(bytes.toString())
          for (const message of [{ result: null, id }, ...valid, gap]) {
            socket.send(JSON.stringify(message))
          }
        })
      })

      const messages = stream({
        exchange: exchangeId,
        filters: [{ channel: 'depth', symbols: ['btcusdt'] }],
        timeoutIntervalMS: 0,
        validateSequence,
        withDisconnects: true,
        onError: (error) => errors.push(error)
      })

      try {
        await messages.next() // Subscription acknowledgement.
        for (const item of valid) {
          assert.deepStrictEqual((await messages.next()).value?.message, item)
        }
        const next = (await messages.next()).value
        if (validateSequence === false) {
          assert.deepStrictEqual(next?.message, gap)
          assert.deepStrictEqual(errors, [])
        } else {
          assert.strictEqual(next, undefined)
          assert.strictEqual(errors.length, 1)
          assert.ok(errors[0] instanceof SequenceGapError)
          assert.strictEqual(errors[0].expectedPreviousSequence, 110)
          assert.strictEqual(errors[0].previousSequence, 130)
          assert.strictEqual(errors[0].key, `btcusdt@depth@${spot ? '100ms' : '0ms'}`)
          assert.strictEqual(errors[0].sequence, 140)
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

test('Binance futures gap restarts public and market sockets and accepts the new connection sequence', { timeout: 10000 }, async () => {
  const errors: Error[] = []
  const depth = (u: number, pu: number) => ({
    stream: 'btcusdt@depth@0ms',
    data: { e: 'depthUpdate', E: 1793786400000, T: 1793786400000, s: 'BTCUSDT', U: u, u, pu, b: [['100', String(u)]], a: [] }
  })
  const waitFor = async (predicate: () => boolean) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (predicate()) return
      await sleep(10)
    }
    assert.fail('Condition did not become true')
  }
  const { server, cleanup } = await createTestWebSocketServer('binance-futures')
  const connections: { socket: WebSocket; path: string }[] = []
  server.on('connection', (socket, request) => {
    const connection = { socket, path: request.url! }
    const index = connections.length
    connections.push(connection)
    socket.on('message', (bytes) => {
      const { id } = JSON.parse(bytes.toString())
      socket.send(JSON.stringify({ result: null, id }))
      const message = connection.path.startsWith('/public')
        ? depth(index < 2 ? 100 : 1, index < 2 ? 80 : 0)
        : { stream: 'btcusdt@markPrice@1s', data: { e: 'markPriceUpdate', p: String(index) } }
      socket.send(JSON.stringify(message))
    })
  })
  const messages = stream({
    exchange: 'binance-futures',
    filters: [
      { channel: 'depth', symbols: ['btcusdt'] },
      { channel: 'markPrice', symbols: ['btcusdt'] }
    ],
    timeoutIntervalMS: 0,
    withDisconnects: true,
    onError: (error) => errors.push(error)
  })
  try {
    const initial = new Set<string>()
    while (initial.size < 2) {
      const item = (await messages.next()).value
      if (item?.message.stream) initial.add(item.message.stream)
    }
    const first = connections.find(({ path }) => path.startsWith('/public'))!
    first.socket.send(JSON.stringify(depth(140, 130)))
    assert.strictEqual((await messages.next()).value, undefined)
    await waitFor(() => connections.slice(0, 2).every(({ socket }) => socket.readyState === 3))
    const recovered = new Set<string>()
    while (recovered.size < 2) {
      const item = (await messages.next()).value
      assert.ok(item !== undefined)
      if (item.message.stream) {
        recovered.add(item.message.stream)
        if (item.message.data.e === 'depthUpdate') assert.strictEqual(item.message.data.u, 1)
      }
    }
    assert.strictEqual(errors.length, 1)
    assert.ok(errors[0] instanceof SequenceGapError)
    assert.strictEqual(connections.length, 4)
  } finally {
    try {
      await messages.return?.()
    } finally {
      await cleanup()
    }
  }
})

for (const validateSequence of [true, false]) {
  test(`Binance delivery pu=-1 requires reinitialization even with validation=${validateSequence}`, { timeout: 10000 }, async () => {
    const errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('binance-delivery')
    server.on('connection', (socket) => {
      socket.on('message', (bytes) => {
        const { id } = JSON.parse(bytes.toString())
        const update = {
          stream: 'btcusd_perp@depth@0ms',
          data: { e: 'depthUpdate', E: 1793786400000, T: 1793786400000, s: 'BTCUSD_PERP', U: 1, u: 1, pu: -1, b: [['100', '1']], a: [] }
        }
        for (const message of [{ result: null, id }, update]) socket.send(JSON.stringify(message))
      })
    })
    const messages = stream({
      exchange: 'binance-delivery',
      filters: [{ channel: 'depth', symbols: ['btcusd_perp'] }],
      timeoutIntervalMS: 0,
      validateSequence,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })
    try {
      await messages.next()
      assert.strictEqual((await messages.next()).value, undefined)
      assert.strictEqual(errors.length, 1)
      assert.match(errors[0].message, /reinitialization required.*BTCUSD_PERP.*pu is -1/)
    } finally {
      try {
        await messages.return?.()
      } finally {
        await cleanup()
      }
    }
  })
}
