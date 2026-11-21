import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { mock, test } from 'node:test'
import { WebSocketServer } from 'ws'
import * as handy from '../dist/handy.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

const requests: string[] = []
const observedSubscriptions: { method: string; params: string[] }[] = []
mock.module('../dist/handy.js', {
  exports: {
    ...handy,
    getJSON: async (url: string) => {
      requests.push(url)
      return { data: { asks: [['101', '1']], bids: [['99', '1']], lastUpdateId: '100', timestamp: 1793369773514033 } }
    }
  }
})
const { stream, streamNormalized, normalizeBookChanges, SequenceGapError } = await import('../dist/index.js')
const { BackpackRealTimeFeed } = await import('../dist/realtimefeeds/backpack.js')

class TestFeed extends BackpackRealTimeFeed {
  map(filters: { channel: string; symbols?: string[] }[]) {
    return this.mapToSubscribeMessages(filters)
  }
}

function depth(symbol: string, U: number, u = U) {
  return { stream: `depth.${symbol}`, data: { s: symbol, U, u, a: [], b: [['99', String(u)]], E: 1793369773514033 + u } }
}

for (const normalized of [false, true]) {
  for (const validateSequence of [undefined, true, false]) {
    test(
      `Backpack ${normalized ? 'normalized' : 'native'} continuity with validateSequence=${validateSequence}`,
      { timeout: 15000 },
      async () => {
        const { server, cleanup } = await createTestWebSocketServer('backpack')
        const errors: Error[] = []
        let connections = 0
        let socket: import('ws').WebSocket
        let startupTimer: NodeJS.Timeout | undefined
        server.on('connection', (client) => {
          socket = client
          connections++
          client.once('message', () => {
            client.send(JSON.stringify(depth('BTC_USDC_PERP', 100)))
            if (normalized) {
              startupTimer = setInterval(() => client.send(JSON.stringify(depth('BTC_USDC_PERP', 100))), 10)
              client.once('close', () => clearInterval(startupTimer))
            }
          })
        })
        const options = {
          exchange: 'backpack' as const,
          timeoutIntervalMS: 0,
          withDisconnectMessages: true,
          withDisconnects: true,
          validateSequence,
          onError: (error: Error) => errors.push(error)
        }
        const feed = normalized
          ? streamNormalized({ ...options, symbols: ['BTC_USDC_PERP'] }, normalizeBookChanges)
          : stream({ ...options, filters: [{ channel: 'depth', symbols: ['BTC_USDC_PERP'] }] })
        try {
          const first = (await feed.next()).value
          clearInterval(startupTimer)
          if (normalized) assert.strictEqual(first.isSnapshot, true)
          else assert.strictEqual(first.message.data.u, 100)

          socket!.send(JSON.stringify(depth('BTC_USDC_PERP', 101, 103)))
          const contiguous = (await feed.next()).value
          if (normalized) {
            assert.strictEqual(contiguous.isSnapshot, false)
            assert.deepEqual(contiguous.bids, [{ price: 99, amount: 103 }])
          } else assert.strictEqual(contiguous.message.data.u, 103)

          // A duplicate must not reset the cursor or reach normalized book output twice.
          socket!.send(JSON.stringify(depth('BTC_USDC_PERP', 101, 103)))
          if (!normalized) assert.strictEqual((await feed.next()).value.message.data.u, 103)
          socket!.send(JSON.stringify(depth('BTC_USDC_PERP', 104)))
          const afterDuplicate = (await feed.next()).value
          if (normalized) assert.deepEqual(afterDuplicate.bids, [{ price: 99, amount: 104 }])
          else assert.strictEqual(afterDuplicate.message.data.u, 104)

          socket!.send(JSON.stringify(depth('BTC_USDC_PERP', 106)))
          const afterGap = (await feed.next()).value
          if (validateSequence === false) {
            if (normalized) assert.deepEqual(afterGap.bids, [{ price: 99, amount: 106 }])
            else assert.strictEqual(afterGap.message.data.u, 106)
            assert.deepEqual(errors, [])
            assert.strictEqual(connections, 1)
          } else {
            if (normalized) assert.strictEqual(afterGap.type, 'disconnect')
            else assert.strictEqual(afterGap, undefined)
            assert.strictEqual(errors.length, 1)
            assert.ok(errors[0] instanceof SequenceGapError)
            assert.strictEqual(errors[0].key, 'BTC_USDC_PERP')
            assert.strictEqual(errors[0].expectedPreviousSequence, 104)
            assert.strictEqual(errors[0].previousSequence, 105)
            const restarted = (await feed.next()).value
            clearInterval(startupTimer)
            if (normalized) assert.strictEqual(restarted.isSnapshot, true)
            else assert.strictEqual(restarted.message.data.u, 100)
            socket!.send(JSON.stringify(depth('BTC_USDC_PERP', 101)))
            const resumed = (await feed.next()).value
            if (normalized) {
              assert.strictEqual(resumed.isSnapshot, false)
              assert.deepEqual(resumed.bids, [{ price: 99, amount: 101 }])
            } else assert.strictEqual(resumed.message.data.u, 101)
            assert.strictEqual(connections, 2)
            assert.strictEqual(errors.length, 1)
          }
        } finally {
          await feed.return?.()
          await cleanup()
        }
      }
    )
  }
}

test('Backpack rejects missing symbols and snapshot-only subscriptions', () => {
  const feed = new TestFeed('backpack', [], 0)
  assert.throws(() => feed.map([{ channel: 'depth' }]), /explicitly specified symbols/)
  assert.throws(() => feed.map([{ channel: 'depth', symbols: [] }]), /explicitly specified symbols/)
  assert.throws(() => feed.map([{ channel: 'depthSnapshot', symbols: ['BTC_USDC'] }]), /requires a depth subscription/)
  assert.throws(() => feed.map([{ channel: 'unsupported', symbols: ['BTC_USDC'] }]), /Unsupported Backpack channel/)
})

for (const validateSequence of [true, false]) {
  test(
    `Backpack keeps sequence counters independent per symbol with validateSequence=${validateSequence}`,
    { timeout: 15000 },
    async () => {
      const { server, cleanup } = await createTestWebSocketServer('backpack')
      const symbols = Array.from({ length: 21 }, (_, i) => `COIN${i}_USDC`)
      const errors: Error[] = []
      let connections = 0
      server.on('connection', (socket) => {
        connections++
        socket.once('message', (bytes) => {
          const { params } = JSON.parse(bytes.toString()) as { params: string[] }
          for (const topic of params) {
            const symbol = topic.slice('depth.'.length)
            const id = symbols.indexOf(symbol) * 1000
            socket.send(JSON.stringify(depth(symbol, id)))
            socket.send(JSON.stringify(depth(symbol, id + (validateSequence ? 1 : 2))))
          }
        })
      })
      const feed = stream({
        exchange: 'backpack',
        filters: [{ channel: 'depth', symbols }],
        timeoutIntervalMS: 0,
        validateSequence,
        onError: (error) => errors.push(error)
      })
      try {
        const counts = new Map<string, number>()
        for (let i = 0; i < symbols.length * 2; i++) {
          const { message } = (await feed.next()).value
          counts.set(message.data.s, (counts.get(message.data.s) ?? 0) + 1)
        }
        assert.strictEqual(connections, 1)
        assert.strictEqual(counts.size, symbols.length)
        assert.ok([...counts.values()].every((count) => count === 2))
        assert.deepEqual(errors, [])
      } finally {
        await feed.return?.()
        await cleanup()
      }
    }
  )
}

test('Backpack initializes a quiet symbol alongside an active symbol and reinitializes after reconnect', { timeout: 15000 }, async () => {
  const server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const previousUrl = process.env.WSS_URL_BACKPACK
  process.env.WSS_URL_BACKPACK = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
  requests.length = 0
  const subscriptions = observedSubscriptions
  subscriptions.length = 0
  server.on('connection', (socket) =>
    socket.on('message', (bytes) => {
      subscriptions.push(JSON.parse(bytes.toString()))
      let sequence = 100
      const timer = setInterval(() => {
        const id = ++sequence
        socket.send(
          JSON.stringify({
            stream: 'depth.BTC_USDC_PERP',
            data: { s: 'BTC_USDC_PERP', U: id, u: id, a: [], b: [['99', '1']], E: 1793369773514033 + id }
          })
        )
      }, 10)
      socket.once('close', () => clearInterval(timer))
    })
  )
  const feed = streamNormalized(
    { exchange: 'backpack', symbols: ['MU.US_USDC_PERP', 'BTC_USDC_PERP'], timeoutIntervalMS: 0, withDisconnectMessages: true },
    normalizeBookChanges
  )
  async function nextQuietBook() {
    while (true) {
      const { value, done } = await feed.next()
      if (done) throw new Error('Feed ended before the quiet book arrived')
      if (value.type === 'book_change' && value.symbol === 'MU.US_USDC_PERP') return value
    }
  }
  try {
    const first = await nextQuietBook()
    assert.strictEqual(first.isSnapshot, true)
    const socket = [...server.clients][0]
    socket.send(
      JSON.stringify({
        stream: 'depth.MU.US_USDC_PERP',
        data: { s: 'MU.US_USDC_PERP', U: 101, u: 101, a: [], b: [['99', '0']], E: 1793369773514133 }
      })
    )
    const delta = await nextQuietBook()
    assert.strictEqual(delta.isSnapshot, false)
    assert.deepEqual(delta.bids, [{ price: 99, amount: 0 }])
    subscriptions.length = 0
    socket.terminate()
    while ((await feed.next()).value!.type !== 'disconnect') {}
    const replacement = await nextQuietBook()
    assert.strictEqual(replacement.isSnapshot, true)
    assert.strictEqual(requests.length, 4)
    assert.deepEqual(subscriptions, [{ method: 'SUBSCRIBE', params: ['depth.BTC_USDC_PERP', 'depth.MU.US_USDC_PERP'] }])
  } finally {
    await feed.return?.()
    if (previousUrl === undefined) delete process.env.WSS_URL_BACKPACK
    else process.env.WSS_URL_BACKPACK = previousUrl
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('Backpack subscribes all symbols on one connection and requests one snapshot per symbol', { timeout: 15000 }, async () => {
  const server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const previousUrl = process.env.WSS_URL_BACKPACK
  process.env.WSS_URL_BACKPACK = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
  requests.length = 0
  const subscriptions = observedSubscriptions
  subscriptions.length = 0
  server.on('connection', (socket) =>
    socket.on('message', (bytes) => {
      subscriptions.push(JSON.parse(bytes.toString()))
      const stream = subscriptions.at(-1)!.params.find((param) => param.startsWith('trade.'))!
      const timer = setInterval(
        () =>
          socket.send(
            JSON.stringify({
              stream,
              data: { s: stream.slice('trade.'.length), t: 1, p: '99', q: '1', m: false, T: 1793369773514033 }
            })
          ),
        10
      )
      socket.once('close', () => clearInterval(timer))
    })
  )
  const symbols = [...Array.from({ length: 20 }, (_, i) => `COIN${i}_USDC`), 'MU.US_USDC_PERP']
  const feed = stream({
    exchange: 'backpack',
    timeoutIntervalMS: 0,
    filters: [
      { channel: 'depth', symbols },
      { channel: 'depthSnapshot', symbols },
      { channel: 'trade', symbols }
    ]
  })
  try {
    const snapshots = new Set<string>()
    for await (const { message } of feed) {
      if (message.stream.startsWith('depthSnapshot.')) snapshots.add(message.stream)
      if (snapshots.size === symbols.length) break
    }
    assert.strictEqual(subscriptions.length, 1)
    assert.strictEqual(requests.length, symbols.length)
    assert.strictEqual(new Set(requests).size, symbols.length)
    for (const symbol of symbols) {
      assert.ok(snapshots.has(`depthSnapshot.${symbol}`))
      assert.ok(subscriptions.some(({ params }) => params.includes(`depth.${symbol}`) && params.includes(`trade.${symbol}`)))
    }
    assert.ok(subscriptions.every(({ params }) => !params.some((param) => param.startsWith('depthSnapshot.'))))
  } finally {
    await feed.return?.()
    if (previousUrl === undefined) delete process.env.WSS_URL_BACKPACK
    else process.env.WSS_URL_BACKPACK = previousUrl
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
