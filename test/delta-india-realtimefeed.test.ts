import { afterEach, test } from 'node:test'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { assert } from './assertions.ts'
import { normalizeBookChanges, stream, streamNormalized, SequenceGapError } from '../dist/index.js'
import { DeltaIndiaWebSocketRealTimeFeed } from '../dist/realtimefeeds/delta_india.js'
import type { Filter } from '../dist/types.js'

const originalURL = process.env.WSS_URL_DELTA_INDIA
const servers: WebSocketServer[] = []
afterEach(async () => {
  if (originalURL === undefined) delete process.env.WSS_URL_DELTA_INDIA
  else process.env.WSS_URL_DELTA_INDIA = originalURL
  for (const server of servers.splice(0)) {
    for (const client of server.clients) client.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

class ProbeFeed extends DeltaIndiaWebSocketRealTimeFeed {
  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }
  error(message: unknown) {
    return this.messageIsError(message)
  }
}

async function localServer(onConnection: (ws: WebSocket) => void) {
  const server = new WebSocketServer({ port: 0 })
  servers.push(server)
  server.on('connection', onConnection)
  await once(server, 'listening')
  process.env.WSS_URL_DELTA_INDIA = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
  return server
}

function depth(symbol: string, action = 'snapshot', seq = 1) {
  return { type: 'ob_updates', action, sy: symbol, seq, a: [['101', '1']], b: [['100', '2']], ts: 1792174097937549 }
}

test('Delta India subscriptions preserve native mark identifiers and individual option symbols', () => {
  const feed = new ProbeFeed('delta-india', [], undefined)
  const [subscription] = feed.map([
    { channel: 'ticker', symbols: ['C-BTC-80000-191026', 'P-BTC-80000-191026', 'BTCUSD'] },
    { channel: 'ob_l1', symbols: ['C-BTC-80000-191026'] },
    { channel: 'mark_price', symbols: ['BTCUSD', 'MARK:ETHUSD', 'all'] },
    { channel: 'system_status', symbols: ['BTCUSD'] }
  ])
  assert.deepEqual(subscription.payload!.channels, [
    { name: 'ticker', symbols: ['C-BTC-80000-191026', 'P-BTC-80000-191026', 'BTCUSD'] },
    { name: 'ob_l1', symbols: ['C-BTC-80000-191026'] },
    { name: 'mark_price', symbols: ['MARK:BTCUSD', 'MARK:ETHUSD', 'all'] },
    { name: 'system_status' }
  ])
  assert.equal(feed.error({ type: 'subscriptions', channels: [{ name: 'ticker', error: 'unsupported' }] }), true)
  assert.equal(feed.error({ type: 'subscriptions', channels: [{ name: 'ticker', error: null }] }), false)
  assert.equal(
    feed.error({
      type: 'ob_updates',
      action: 'error',
      symbol: 'BTCUSD',
      msg: 'Snapshot load failed. Verify if product is live and resubscribe after a few secs.'
    }),
    false
  )
})

test('Delta India sends all requested depth symbols on one connection and routes market data separately', { timeout: 10000 }, async () => {
  const received: Array<{ ws: WebSocket; channels: Array<{ name: string; symbols?: string[] }> }> = []
  await localServer((ws) =>
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString())
      if (message.type !== 'subscribe') return
      received.push({ ws, channels: message.payload.channels })
      ws.send(JSON.stringify({ type: 'subscriptions', channels: message.payload.channels }))
    })
  )
  const symbols = Array.from({ length: 201 }, (_, i) => `COIN${i}USD`)
  const iterator = stream({
    exchange: 'delta-india',
    filters: [
      { channel: 'ob_updates', symbols },
      { channel: 'trades', symbols: ['BTCUSD'] }
    ]
  })
  try {
    for await (const _message of iterator) {
      if (received.length === 2) break
    }
    const depthSubscription = received.find((r) => r.channels[0].name === 'ob_updates')!
    const depthChannel = depthSubscription.channels[0]
    assert.deepEqual(new Set(depthChannel.symbols), new Set(symbols))
    const marketSubscription = received.find((r) => r.channels[0].name === 'trades')!
    assert.deepEqual(marketSubscription.channels, [{ name: 'trades', symbols: ['BTCUSD'] }])
    assert.equal(new Set(received.map((r) => r.ws)).size, 2)
  } finally {
    await iterator.return?.()
  }
})

test('Delta India rejects absent, empty and aggregate depth symbols before opening sockets', async () => {
  for (const symbols of [undefined, [], ['all'], ['BTC-191026']]) {
    const iterator = stream({ exchange: 'delta-india', filters: [{ channel: 'ob_updates', symbols }] })
    await assert.rejects(iterator.next(), /requires (explicitly specified|individual instrument) symbols/)
    await iterator.return?.()
  }
})

for (const snapshotFailure of ['missing', 'failed']) {
  for (const validateSequence of [undefined, false]) {
    test(
      `Delta India retries a ${snapshotFailure} native snapshot: validation=${validateSequence ?? 'default'}`,
      { timeout: 15000 },
      async () => {
        let subscriptions = 0
        await localServer((ws) =>
          ws.on('message', (data) => {
            const message = JSON.parse(data.toString())
            if (message.type !== 'subscribe') return
            subscriptions++
            ws.send(JSON.stringify({ type: 'subscriptions', channels: message.payload.channels }))
            if (subscriptions === 1) {
              if (snapshotFailure === 'failed') {
                ws.send(
                  JSON.stringify({
                    type: 'ob_updates',
                    action: 'error',
                    symbol: 'BTCUSD',
                    msg: 'Snapshot load failed. Verify if product is live and resubscribe after a few secs.'
                  })
                )
              }
              // Updates must wait for a valid snapshot, with or without an explicit error.
              ws.send(JSON.stringify(depth('BTCUSD', 'update', 2)))
              ws.send(JSON.stringify(depth('BTCUSD', 'update', 99)))
            } else {
              ws.send(JSON.stringify(depth('BTCUSD', 'snapshot', 4)))
              ws.send(JSON.stringify(depth('BTCUSD', 'update', 5)))
            }
          })
        )
        const iterator = streamNormalized(
          { exchange: 'delta-india', symbols: ['BTCUSD'], timeoutIntervalMS: 0, validateSequence },
          normalizeBookChanges
        )
        try {
          const first = await iterator.next()
          assert.equal(first.value!.isSnapshot, true)
          assert.equal((await iterator.next()).value!.isSnapshot, false)
          assert.equal(subscriptions, 2)
        } finally {
          await iterator.return?.()
        }
      }
    )
  }
}

test('Delta India detects a depth gap and reinitializes subscribed books after reconnect', { timeout: 15000 }, async () => {
  const subscriptions: Array<{ ws: WebSocket; symbols: string[] }> = []
  await localServer((ws) =>
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString())
      if (message.type !== 'subscribe') return
      const symbols = message.payload.channels[0].symbols as string[]
      subscriptions.push({ ws, symbols })
      ws.send(JSON.stringify({ type: 'subscriptions', channels: message.payload.channels }))
      for (const symbol of symbols) ws.send(JSON.stringify(depth(symbol)))
    })
  )
  const symbols = ['BTCUSD', 'ETHUSD']
  const errors: Error[] = []
  const iterator = streamNormalized(
    { exchange: 'delta-india', symbols, timeoutIntervalMS: 0, onError: (error) => errors.push(error), withDisconnectMessages: true },
    normalizeBookChanges
  )
  try {
    const initial = new Set<string>()
    while (initial.size < symbols.length) {
      const { value } = await iterator.next()
      if (value!.type === 'book_change') initial.add(value!.symbol)
    }
    const interrupted = subscriptions[0]
    interrupted.ws.send(JSON.stringify(depth(interrupted.symbols[0], 'update', 3)))
    let disconnected = false
    const recovered = new Set<string>()
    while (recovered.size < symbols.length) {
      const { value } = await iterator.next()
      if (value!.type === 'disconnect') {
        disconnected = true
        continue
      }
      if (disconnected && value!.isSnapshot) recovered.add(value!.symbol)
    }
    assert.equal(errors.length, 1)
    assert.ok(errors[0] instanceof SequenceGapError)
    assert.deepEqual(recovered, new Set(symbols))
    assert.notEqual(subscriptions.at(-1)!.ws, interrupted.ws)
  } finally {
    await iterator.return?.()
  }
})

for (const validateSequence of [undefined, true, false]) {
  test(`Delta India continuity and snapshot resets: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const valid = [
      depth('BTCUSD', 'update', 10),
      depth('BTCUSD', 'update', 20),
      depth('BTCUSD', 'snapshot', 100),
      depth('ETHUSD', 'snapshot', 900),
      depth('BTCUSD', 'update', 101),
      depth('BTCUSD', 'update', 101),
      { type: 'trades', sy: 'BTCUSD', seq: 9999 },
      { type: 'heartbeat' },
      {
        type: 'ob_updates',
        action: 'error',
        symbol: 'BTCUSD',
        msg: 'Snapshot load failed. Verify if product is live and resubscribe after a few secs.'
      },
      depth('BTCUSD', 'update', 500),
      depth('BTCUSD', 'update', 800),
      depth('BTCUSD', 'snapshot', 0),
      depth('BTCUSD', 'update', 1),
      depth('ETHUSD', 'update', 901)
    ]
    const gap = depth('BTCUSD', 'update', 3)
    await localServer((socket) =>
      socket.once('message', () => {
        for (const message of [...valid, gap]) socket.send(JSON.stringify(message))
      })
    )
    const errors: Error[] = []
    const messages = stream({
      exchange: 'delta-india',
      filters: [{ channel: 'ob_updates', symbols: ['BTCUSD', 'ETHUSD'] }],
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
        assert.strictEqual(errors[0].exchange, 'delta-india')
        assert.strictEqual(errors[0].key, 'BTCUSD')
        assert.strictEqual(errors[0].expectedPreviousSequence, 1)
        assert.strictEqual(errors[0].previousSequence, 2)
        assert.strictEqual(errors[0].sequence, 3)
      }
    } finally {
      await messages.return?.()
    }
  })
}

for (const validateSequence of [undefined, false]) {
  test(
    `Delta India recovery restarts depth and market connections: validation=${validateSequence ?? 'default'}`,
    { timeout: 10000 },
    async () => {
      const connections: { socket: WebSocket; channel?: string }[] = []
      await localServer((socket) => {
        const connection: { socket: WebSocket; channel?: string } = { socket }
        connections.push(connection)
        socket.on('message', (data) => {
          const request = JSON.parse(data.toString())
          if (request.type !== 'subscribe') return
          connection.channel = request.payload.channels[0].name
          socket.send(JSON.stringify({ type: 'subscriptions', channels: request.payload.channels }))
          if (connection.channel === 'ob_updates')
            socket.send(JSON.stringify(depth('BTCUSD', 'snapshot', connections.length <= 2 ? 100 : 1)))
        })
      })
      const errors: Error[] = []
      const messages = stream({
        exchange: 'delta-india',
        filters: [
          { channel: 'ob_updates', symbols: ['BTCUSD'] },
          { channel: 'trades', symbols: ['BTCUSD'] }
        ],
        timeoutIntervalMS: 0,
        validateSequence,
        withDisconnects: true,
        onError: (error) => errors.push(error)
      })
      try {
        let initialized = false
        while (!initialized || connections.some((connection) => !connection.channel) || connections.length < 2) {
          const item = (await messages.next()).value
          if (item?.message.type === 'ob_updates') initialized = true
        }
        const originals = connections.slice()
        originals.find((connection) => connection.channel === 'ob_updates')!.socket.send(JSON.stringify(depth('BTCUSD', 'update', 103)))
        let item = (await messages.next()).value
        if (validateSequence === false) {
          assert.deepStrictEqual(item?.message, depth('BTCUSD', 'update', 103))
          assert.strictEqual(connections.length, 2)
          assert.deepStrictEqual(errors, [])
        } else {
          while (item !== undefined) item = (await messages.next()).value
          while (true) {
            const recovered = (await messages.next()).value
            if (recovered?.message.type === 'ob_updates') {
              assert.deepStrictEqual(recovered.message, depth('BTCUSD', 'snapshot', 1))
              break
            }
          }
          assert.strictEqual(connections.length, 4)
          assert.ok(originals.every((connection) => connection.socket.readyState === 3))
          assert.strictEqual(errors.length, 1)
          assert.ok(errors[0] instanceof SequenceGapError)
        }
      } finally {
        await messages.return?.()
      }
    }
  )
}

test('Delta India normalized opt-out accepts duplicate and gapped updates', { timeout: 10000 }, async () => {
  await localServer((socket) =>
    socket.once('message', () => {
      for (const message of [
        depth('BTCUSD', 'snapshot', 100),
        depth('BTCUSD', 'update', 101),
        depth('BTCUSD', 'update', 101),
        depth('BTCUSD', 'update', 103)
      ])
        socket.send(JSON.stringify(message))
    })
  )
  const errors: Error[] = []
  const messages = streamNormalized(
    {
      exchange: 'delta-india',
      symbols: ['BTCUSD'],
      timeoutIntervalMS: 0,
      validateSequence: false,
      withDisconnectMessages: true,
      onError: (error) => errors.push(error)
    },
    normalizeBookChanges
  )
  try {
    for (const isSnapshot of [true, false, false, false]) {
      const item = (await messages.next()).value
      assert.ok(item.type === 'book_change')
      assert.strictEqual(item.isSnapshot, isSnapshot)
    }
    assert.deepStrictEqual(errors, [])
  } finally {
    await messages.return?.()
  }
})
