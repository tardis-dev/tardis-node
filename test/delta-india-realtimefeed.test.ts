import { afterEach, test } from 'node:test'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { assert } from './assertions.ts'
import { normalizeBookChanges, stream, streamNormalized } from '../dist/index.js'
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

test('Delta India subscriptions preserve native mark identifiers and deduplicate option chains', () => {
  const feed = new ProbeFeed('delta-india', [], undefined)
  const [subscription] = feed.map([
    { channel: 'ticker', symbols: ['C-BTC-80000-191026', 'P-BTC-80000-191026', 'BTCUSD'] },
    { channel: 'ob_l1', symbols: ['C-BTC-80000-191026'] },
    { channel: 'mark_price', symbols: ['BTCUSD', 'MARK:ETHUSD', 'all'] },
    { channel: 'system_status', symbols: ['BTCUSD'] }
  ])
  assert.deepEqual(subscription.payload!.channels, [
    { name: 'ticker', symbols: ['BTC-191026', 'BTCUSD'] },
    { name: 'ob_l1', symbols: ['BTC-191026'] },
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

test('Delta India retries a missing native snapshot before emitting normalized deltas', { timeout: 15000 }, async () => {
  let subscriptions = 0
  await localServer((ws) =>
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString())
      if (message.type !== 'subscribe') return
      subscriptions++
      ws.send(JSON.stringify({ type: 'subscriptions', channels: message.payload.channels }))
      if (subscriptions === 1) {
        // Acknowledgement plus updates without an initial snapshot is observed upstream.
        ws.send(JSON.stringify(depth('BTCUSD', 'update', 2)))
        ws.send(JSON.stringify(depth('BTCUSD', 'update', 3)))
      } else {
        ws.send(JSON.stringify(depth('BTCUSD', 'snapshot', 4)))
        ws.send(JSON.stringify(depth('BTCUSD', 'update', 5)))
      }
    })
  )
  const iterator = streamNormalized({ exchange: 'delta-india', symbols: ['BTCUSD'], timeoutIntervalMS: 0 }, normalizeBookChanges)
  try {
    const first = await iterator.next()
    assert.equal(first.value!.isSnapshot, true)
    assert.equal((await iterator.next()).value!.isSnapshot, false)
    assert.equal(subscriptions, 2)
  } finally {
    await iterator.return?.()
  }
})

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
    assert.ok(errors.some((error) => error.message.includes('sequence gap')))
    assert.deepEqual(recovered, new Set(symbols))
    assert.notEqual(subscriptions.at(-1)!.ws, interrupted.ws)
  } finally {
    await iterator.return?.()
  }
})
