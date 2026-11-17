import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { mock, test } from 'node:test'
import { WebSocketServer } from 'ws'
import * as handy from '../dist/handy.js'
import { assert } from './assertions.ts'

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
const { stream, streamNormalized, normalizeBookChanges } = await import('../dist/index.js')
const { BackpackSingleConnectionRealTimeFeed } = await import('../dist/realtimefeeds/backpack.js')

class TestFeed extends BackpackSingleConnectionRealTimeFeed {
  map(filters: { channel: string; symbols?: string[] }[]) {
    return this.mapToSubscribeMessages(filters)
  }
}

test('Backpack rejects missing symbols and snapshot-only subscriptions', () => {
  const feed = new TestFeed('backpack', [], 0)
  assert.throws(() => feed.map([{ channel: 'depth' }]), /explicitly specified symbols/)
  assert.throws(() => feed.map([{ channel: 'depth', symbols: [] }]), /explicitly specified symbols/)
  assert.throws(() => feed.map([{ channel: 'depthSnapshot', symbols: ['BTC_USDC'] }]), /requires a depth subscription/)
  assert.throws(() => feed.map([{ channel: 'unsupported', symbols: ['BTC_USDC'] }]), /Unsupported Backpack channel/)
})

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

test(
  'Backpack batches mixed subscriptions across twenty-symbol boundaries and requests one snapshot per symbol',
  { timeout: 15000 },
  async () => {
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
      assert.strictEqual(subscriptions.length, 2)
      assert.ok(subscriptions.every((subscription) => subscription.params.length <= 40))
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
  }
)
