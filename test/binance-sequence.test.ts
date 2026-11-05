import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { mock, test, type TestContext } from 'node:test'
import { WebSocketServer, type WebSocket } from 'ws'
import * as handy from '../dist/handy.js'
import { assert } from './assertions.ts'

let snapshotId = 100
let snapshotRequests = 0
let snapshotDelayMS = 0
mock.module('../dist/handy.js', {
  exports: {
    ...handy,
    getJSON: async (url: string) => {
      if (new URL(url).pathname.endsWith('/exchangeInfo')) {
        return { data: { rateLimits: [{ rateLimitType: 'REQUEST_WEIGHT', limit: 2400 }] }, headers: {} }
      }
      const lastUpdateId = snapshotId
      snapshotRequests++
      await sleep(snapshotDelayMS)
      return { data: { lastUpdateId, bids: [['100', String(lastUpdateId)]], asks: [] }, headers: {} }
    }
  }
})

const { stream, streamNormalized, normalizeBookChanges, normalizeTrades, SequenceGapError } = await import('../dist/index.js')

type Connection = { socket: WebSocket; path: string; streams: Set<string> }
async function exchange(
  t: TestContext,
  subscribed: (connection: Connection, index: number) => void,
  exchangeId: 'binance' | 'binance-us' | 'binance-futures' | 'binance-delivery' = 'binance-futures'
) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  const envKey = `WSS_URL_${exchangeId.toUpperCase().replaceAll('-', '_')}`
  const previousURL = process.env[envKey]
  process.env[envKey] = `ws://127.0.0.1:${address.port}`
  const connections: Connection[] = []
  server.on('connection', (socket, request) => {
    const connection = { socket, path: request.url!, streams: new Set<string>() }
    connections.push(connection)
    socket.on('message', (bytes) => {
      const { params, id } = JSON.parse(bytes.toString())
      for (const name of params) connection.streams.add(name)
      send(socket, { result: null, id })
      subscribed(connection, connections.indexOf(connection))
    })
  })
  t.after(async () => {
    if (previousURL === undefined) delete process.env[envKey]
    else process.env[envKey] = previousURL
    for (const connection of connections) connection.socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return connections
}

function depth(u: number, pu: number, symbol = 'BTCUSDT', U = u) {
  return {
    stream: `${symbol.toLowerCase()}@depth@0ms`,
    data: { e: 'depthUpdate', E: 1793786400000, T: 1793786400000, s: symbol, U, u, pu, b: [['100', String(u)]], a: [] }
  }
}
function repeat(t: TestContext, socket: WebSocket, message: object) {
  const timer = setInterval(() => {
    if (socket.readyState === socket.OPEN) send(socket, message)
  }, 20)
  socket.once('close', () => clearInterval(timer))
  t.after(() => clearInterval(timer))
}

function send(socket: WebSocket, ...messages: object[]) {
  for (const message of messages) socket.send(JSON.stringify(message))
}
async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await sleep(10)
  }
  assert.fail('Condition did not become true')
}

test(
  'Binance futures validates pu per stream, accepting batched ranges, duplicates and unrelated messages',
  { timeout: 10000 },
  async (t) => {
    const errors: Error[] = []
    const items = [
      depth(100, 80, 'BTCUSDT', 90),
      depth(500, 450, 'ETHUSDT', 490),
      { stream: 'btcusdt@trade', data: { e: 'trade', u: 999, pu: 998 } },
      depth(110, 100, 'BTCUSDT', 105),
      depth(110, 100, 'BTCUSDT', 105),
      depth(520, 500, 'ETHUSDT', 515),
      { stream: 'btcusdt@depthSnapshot', generated: true, data: { lastUpdateId: 50, bids: [], asks: [] } },
      depth(120, 110)
    ]
    await exchange(t, ({ socket }) => send(socket, ...items, depth(140, 130), depth(150, 140)))
    const messages = stream({
      exchange: 'binance-futures',
      filters: [{ channel: 'depth', symbols: ['btcusdt', 'ethusdt'] }],
      timeoutIntervalMS: 0,
      validateSequence: true,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })
    t.after(() => messages.return?.())
    assert.deepStrictEqual((await messages.next()).value?.message, { result: null, id: 1 })
    for (const item of items) assert.deepStrictEqual((await messages.next()).value?.message, item)
    assert.strictEqual((await messages.next()).value, undefined)
    assert.strictEqual(errors.length, 1)
    const error = errors[0]
    assert.ok(error instanceof SequenceGapError)
    assert.strictEqual(error.key, 'btcusdt@depth@0ms')
    assert.strictEqual(error.expectedPreviousSequence, 120)
    assert.strictEqual(error.previousSequence, 130)
    assert.strictEqual(error.sequence, 140)
  }
)

test('Binance futures opt-out preserves discontinuous raw updates', { timeout: 10000 }, async (t) => {
  const items = [depth(100, 80), depth(140, 130)]
  await exchange(t, ({ socket }) => send(socket, ...items))
  const messages = stream({
    exchange: 'binance-futures',
    filters: [{ channel: 'depth', symbols: ['btcusdt'] }],
    timeoutIntervalMS: 0,
    validateSequence: false,
    onError: (error) => assert.fail(error.message)
  })
  t.after(() => messages.return?.())
  await messages.next()
  for (const item of items) assert.deepStrictEqual((await messages.next()).value.message, item)
})

test('Binance futures keeps large safe sequence IDs exact', { timeout: 10000 }, async (t) => {
  const last = Number.MAX_SAFE_INTEGER - 20
  const items = [depth(last, last - 10), depth(last + 10, last)]
  await exchange(t, ({ socket }) => send(socket, ...items))
  const messages = stream({
    exchange: 'binance-futures',
    filters: [{ channel: 'depth', symbols: ['btcusdt'] }],
    timeoutIntervalMS: 0,
    validateSequence: true,
    onError: (error) => assert.fail(error.message)
  })
  t.after(() => messages.return?.())
  await messages.next()
  for (const item of items) assert.deepStrictEqual((await messages.next()).value.message, item)
})

test('Binance futures gap restarts public and market sockets and accepts the new connection sequence', { timeout: 10000 }, async (t) => {
  const errors: Error[] = []
  const connections = await exchange(t, (connection, index) => {
    if (connection.path.startsWith('/public')) send(connection.socket, depth(index < 2 ? 100 : 1, index < 2 ? 80 : 0))
    else send(connection.socket, { stream: 'btcusdt@markPrice@1s', data: { e: 'markPriceUpdate', p: String(index) } })
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
  t.after(() => messages.return?.())
  const initial = new Set<string>()
  while (initial.size < 2) {
    const item = (await messages.next()).value
    if (item?.message.stream) initial.add(item.message.stream)
  }
  const first = connections.find(({ path }) => path.startsWith('/public'))!
  send(first.socket, depth(140, 130))
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
})

for (const validateSequence of [true, false]) {
  test(`Binance futures normalized book recovery (validateSequence=${validateSequence})`, { timeout: 10000 }, async (t) => {
    snapshotRequests = 0
    snapshotDelayMS = 0
    snapshotId = 100
    const errors: Error[] = []
    const connections = await exchange(t, ({ socket }, index) => {
      snapshotId = index === 0 ? 100 : 200
      send(socket, depth(snapshotId, snapshotId - 10), depth(snapshotId + 1, snapshotId))
      repeat(t, socket, depth(snapshotId + 1, snapshotId))
    })
    const messages = streamNormalized(
      {
        exchange: 'binance-futures',
        symbols: ['btcusdt'],
        timeoutIntervalMS: 0,
        validateSequence,
        withDisconnectMessages: true,
        onError: (error) => errors.push(error)
      },
      normalizeBookChanges
    )
    t.after(() => messages.return?.())
    const initial = []
    while (initial.filter((item) => item.type === 'book_change').length < 3) {
      initial.push((await messages.next()).value)
    }
    assert.ok(initial[0].type === 'book_change' && initial[0].isSnapshot)
    assert.strictEqual(snapshotRequests, 1)
    send(connections[0].socket, depth(110, 109))
    let next = (await messages.next()).value
    if (validateSequence) {
      while (next.type !== 'disconnect') {
        assert.ok(next.type !== 'book_change' || next.bids[0]?.amount !== 110)
        next = (await messages.next()).value
      }
      const snapshot = (await messages.next()).value
      assert.ok(snapshot.type === 'book_change' && snapshot.isSnapshot)
      assert.deepStrictEqual(snapshot.bids, [{ price: 100, amount: 201 }])
      const update = (await messages.next()).value
      assert.ok(update.type === 'book_change' && !update.isSnapshot)
      assert.strictEqual(snapshotRequests, 2)
      assert.strictEqual(errors.length, 1)
      assert.ok(errors[0] instanceof SequenceGapError)
    } else {
      while (next.type !== 'book_change' || next.bids[0]?.amount !== 110) next = (await messages.next()).value
      assert.ok(next.type === 'book_change' && !next.isSnapshot)
      assert.deepStrictEqual(next.bids, [{ price: 100, amount: 110 }])
      assert.strictEqual(snapshotRequests, 1)
      assert.deepStrictEqual(errors, [])
    }
  })
}

test('Binance futures detects a gap while a REST snapshot is pending and discards the old snapshot', { timeout: 10000 }, async (t) => {
  snapshotRequests = 0
  snapshotDelayMS = 200
  snapshotId = 100
  const errors: Error[] = []
  await exchange(t, ({ socket }, index) => {
    snapshotId = index === 0 ? 100 : 200
    send(socket, depth(snapshotId, snapshotId - 10), depth(snapshotId + 1, snapshotId))
    repeat(t, socket, depth(snapshotId + 1, snapshotId))
    if (index === 0) {
      const timer = setInterval(() => {
        if (snapshotRequests) {
          clearInterval(timer)
          send(socket, depth(110, 109))
        }
      }, 5)
      t.after(() => clearInterval(timer))
    }
  })
  const messages = streamNormalized(
    {
      exchange: 'binance-futures',
      symbols: ['btcusdt'],
      timeoutIntervalMS: 0,
      validateSequence: true,
      withDisconnectMessages: true,
      onError: (error) => errors.push(error)
    },
    normalizeBookChanges
  )
  t.after(() => messages.return?.())
  assert.strictEqual((await messages.next()).value.type, 'disconnect')
  const snapshot = (await messages.next()).value
  assert.ok(snapshot.type === 'book_change' && snapshot.isSnapshot)
  assert.deepStrictEqual(snapshot.bids, [{ price: 100, amount: 201 }])
  assert.strictEqual(snapshotRequests, 2)
  assert.strictEqual(errors.length, 1)
})

test('Binance futures validates depth even when a custom normalizer only emits trades', { timeout: 10000 }, async (t) => {
  const errors: Error[] = []
  await exchange(t, ({ socket }) =>
    send(
      socket,
      depth(100, 80),
      { stream: 'btcusdt@trade', data: { e: 'trade', E: 1793786400000, T: 1793786400000, s: 'BTCUSDT', t: 1, p: '100', q: '1', m: false } },
      depth(110, 109)
    )
  )
  const normalizer = (exchange: 'binance-futures', timestamp: Date) => {
    const mapper = normalizeTrades(exchange, timestamp)
    return {
      ...mapper,
      canHandle: mapper.canHandle.bind(mapper),
      map: mapper.map.bind(mapper),
      getFilters: () => [
        { channel: 'trade' as const, symbols: ['btcusdt'] },
        { channel: 'depth' as const, symbols: ['btcusdt'] }
      ]
    }
  }
  const messages = streamNormalized(
    {
      exchange: 'binance-futures',
      symbols: ['btcusdt'],
      timeoutIntervalMS: 0,
      validateSequence: true,
      withDisconnectMessages: true,
      onError: (error) => errors.push(error)
    },
    normalizer
  )
  t.after(() => messages.return?.())
  assert.strictEqual((await messages.next()).value.type, 'trade')
  assert.strictEqual((await messages.next()).value.type, 'disconnect')
  assert.strictEqual(errors.length, 1)
})

for (const exchangeId of ['binance', 'binance-us', 'binance-delivery'] as const) {
  const spot = exchangeId !== 'binance-delivery'
  const suffix = spot ? '100ms' : '0ms'
  const update = (u: number, previous: number, symbol = 'BTCUSDT') => {
    const message = depth(u, previous, symbol, spot ? previous + 1 : u - 1)
    const { pu, ...data } = message.data
    return { stream: `${symbol.toLowerCase()}@depth@${suffix}`, data: spot ? data : { ...data, pu } }
  }

  test(`${exchangeId} checks the correct depth link per stream and drops gaps`, { timeout: 10000 }, async (t) => {
    const errors: Error[] = []
    const items = [
      update(100, 80),
      update(500, 450, 'ETHUSDT'),
      update(110, 100),
      update(110, 100),
      { stream: 'btcusdt@bookTicker', data: { u: 9999, U: 9990, pu: 9990 } },
      { stream: 'btcusdt@depthSnapshot', generated: true, data: { lastUpdateId: 50, bids: [], asks: [] } },
      update(520, 500, 'ETHUSDT'),
      update(120, 110)
    ]
    await exchange(t, ({ socket }) => send(socket, ...items, update(140, 130), update(150, 140)), exchangeId)
    const messages = stream({
      exchange: exchangeId,
      filters: [{ channel: 'depth', symbols: ['btcusdt', 'ethusdt'] }],
      timeoutIntervalMS: 0,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })
    t.after(() => messages.return?.())
    await messages.next()
    for (const item of items) assert.deepStrictEqual((await messages.next()).value?.message, item)
    assert.strictEqual((await messages.next()).value, undefined)
    assert.strictEqual(errors.length, 1)
    assert.ok(errors[0] instanceof SequenceGapError)
    assert.strictEqual(errors[0].key, `btcusdt@depth@${suffix}`)
    assert.strictEqual(errors[0].expectedPreviousSequence, 120)
    assert.strictEqual(errors[0].previousSequence, 130)
  })

  test(`${exchangeId} opt-out passes gaps`, { timeout: 10000 }, async (t) => {
    const items = [update(100, 80), update(140, 130)]
    await exchange(t, ({ socket }) => send(socket, ...items), exchangeId)
    const messages = stream({
      exchange: exchangeId,
      filters: [{ channel: 'depth', symbols: ['btcusdt'] }],
      timeoutIntervalMS: 0,
      validateSequence: false,
      onError: (error) => assert.fail(error.message)
    })
    t.after(() => messages.return?.())
    await messages.next()
    for (const item of items) assert.deepStrictEqual((await messages.next()).value.message, item)
  })

  for (const snapshotDelay of [0, 200]) {
    test(`${exchangeId} recovers a normalized book after a gap (snapshot delay ${snapshotDelay}ms)`, { timeout: 10000 }, async (t) => {
      snapshotId = 100
      snapshotRequests = 0
      snapshotDelayMS = snapshotDelay
      const errors: Error[] = []
      const connections = await exchange(
        t,
        ({ socket }, index) => {
          snapshotId = index === 0 ? 100 : 200
          send(socket, update(snapshotId, snapshotId - 10), update(snapshotId + 1, snapshotId))
          repeat(t, socket, update(snapshotId + 1, snapshotId))
          if (index === 0 && snapshotDelay) {
            const timer = setInterval(() => {
              if (snapshotRequests) {
                clearInterval(timer)
                send(socket, update(110, 109))
              }
            }, 5)
            t.after(() => clearInterval(timer))
          }
        },
        exchangeId
      )
      const messages = streamNormalized(
        {
          exchange: exchangeId,
          symbols: ['btcusdt'],
          timeoutIntervalMS: 0,
          withDisconnectMessages: true,
          onError: (error) => errors.push(error)
        },
        normalizeBookChanges
      )
      t.after(() => messages.return?.())
      let item = (await messages.next()).value
      if (!snapshotDelay) {
        assert.ok(item.type === 'book_change' && item.isSnapshot)
        send(connections[0].socket, update(110, 109))
        item = (await messages.next()).value
      }
      while (item.type !== 'disconnect') {
        assert.ok(item.type !== 'book_change' || item.bids[0]?.amount !== 110)
        item = (await messages.next()).value
      }
      const snapshot = (await messages.next()).value
      assert.ok(snapshot.type === 'book_change' && snapshot.isSnapshot)
      assert.deepStrictEqual(snapshot.bids, [{ price: 100, amount: 201 }])
      const delta = (await messages.next()).value
      assert.ok(delta.type === 'book_change' && !delta.isSnapshot)
      assert.strictEqual(snapshotRequests, 2)
      assert.strictEqual(errors.length, 1)
      assert.ok(errors[0] instanceof SequenceGapError)
    })
  }
}

for (const validateSequence of [true, false]) {
  test(`Binance delivery pu=-1 requires reinitialization even with validation=${validateSequence}`, { timeout: 10000 }, async (t) => {
    const errors: Error[] = []
    await exchange(t, ({ socket }) => send(socket, depth(1, -1, 'BTCUSD_PERP')), 'binance-delivery')
    const messages = stream({
      exchange: 'binance-delivery',
      filters: [{ channel: 'depth', symbols: ['btcusd_perp'] }],
      timeoutIntervalMS: 0,
      validateSequence,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })
    t.after(() => messages.return?.())
    await messages.next()
    assert.strictEqual((await messages.next()).value, undefined)
    assert.strictEqual(errors.length, 1)
    assert.match(errors[0].message, /reinitialization required.*BTCUSD_PERP.*pu is -1/)
  })
}
