import { test } from 'node:test'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'
import { normalizeBookChanges, SequenceGapError, stream, streamNormalized } from '../dist/index.js'
import { WooxRealTimeFeed } from '../dist/realtimefeeds/woox.js'

for (const validateSequence of [undefined, true, false]) {
  test(`WOO X depth continuity: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const depth = (ts: number, prevTs: number, s = 'SPOT_BTC_USDT') => ({
      topic: `orderbookupdate@${s}@50`,
      ts: 999999,
      data: { s, ts, prevTs, bids: [], asks: [] }
    })
    const native = [
      { id: 'SPOT_BTC_USDT', cmd: 'SUBSCRIBE', success: true },
      { cmd: 'PING' },
      depth(100, 99),
      depth(105, 100),
      depth(105, 100),
      depth(110, 105),
      depth(500, 499, 'PERP_BTC_USDT'),
      depth(505, 500, 'PERP_BTC_USDT'),
      { topic: 'orderbook@SPOT_BTC_USDT@50', generated: true, ts: 90, data: { bids: [], asks: [] } },
      { ...depth(9999, 9998), topic: 'bbo@SPOT_BTC_USDT' },
      depth(115, 110)
    ]
    const gap = depth(120, 119),
      errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('woo-x')
    server.on('connection', (socket) =>
      socket.once('message', (bytes) => {
        assert.deepStrictEqual(JSON.parse(bytes.toString()), {
          id: 'PERP_BTC_USDT',
          cmd: 'subscribe',
          params: ['orderbookupdate@PERP_BTC_USDT@50']
        })
        for (const message of [...native, gap]) socket.send(JSON.stringify(message))
      })
    )
    const messages = stream({
      exchange: 'woo-x',
      filters: [{ channel: 'orderbookupdate', symbols: ['SPOT_BTC_USDT', 'PERP_BTC_USDT'] }],
      timeoutIntervalMS: 0,
      validateSequence,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })
    try {
      for (const message of native) assert.deepStrictEqual((await messages.next()).value?.message, message)
      const next = (await messages.next()).value
      if (validateSequence === false) {
        assert.deepStrictEqual(next?.message, gap)
        assert.deepStrictEqual(errors, [])
      } else {
        assert.strictEqual(next, undefined)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
        assert.strictEqual(errors[0].exchange, 'woo-x')
        assert.strictEqual(errors[0].key, 'SPOT_BTC_USDT')
        assert.strictEqual(errors[0].expectedPreviousSequence, 115)
        assert.strictEqual(errors[0].previousSequence, 119)
        assert.strictEqual(errors[0].sequence, 120)
      }
    } finally {
      await messages.return?.()
      await cleanup()
    }
  })
}

// The feed has a fixed HTTP endpoint. Redirect it at the existing hook and execute the real snapshot provider.
function useSnapshotURL(url: string, onReady: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(WooxRealTimeFeed.prototype, 'provideManualSnapshots')!
  Object.defineProperty(WooxRealTimeFeed.prototype, 'provideManualSnapshots', {
    ...descriptor,
    value: async function (...args: unknown[]) {
      Object.defineProperty(this, 'httpURL', { value: url })
      await descriptor.value.apply(this, args)
      onReady()
    }
  })
  return () => Object.defineProperty(WooxRealTimeFeed.prototype, 'provideManualSnapshots', descriptor)
}

for (const normalized of [false, true]) {
  for (const withDisconnects of [false, true]) {
    test(`WOO X depth recovery: normalized=${normalized}, disconnects=${withDisconnects}`, { timeout: 10000 }, async () => {
      const depth = (ts: number, prevTs: number) => ({
        topic: 'orderbookupdate@SPOT_BTC_USDT@50',
        ts: ts + 1000,
        data: { s: 'SPOT_BTC_USDT', ts, prevTs, bids: [['100', String(ts)]], asks: [] }
      })
      let connections = 0,
        requests = 0
      const errors: Error[] = [],
        { server, cleanup } = await createTestWebSocketServer('woo-x')
      let sendGap: (() => void) | undefined
      const http = createServer((request, response) => {
        assert.strictEqual(request.url, '/v3/public/orderbook?symbol=SPOT_BTC_USDT&maxLevel=50')
        requests++
        response.setHeader('content-type', 'application/json')
        const ts = connections === 1 ? 100 : 0
        response.end(JSON.stringify({ success: true, timestamp: ts, data: { bids: [{ price: '100', quantity: String(ts) }], asks: [] } }))
      })
      http.listen(0, '127.0.0.1')
      await once(http, 'listening')
      const address = http.address()
      assert.ok(address && typeof address === 'object')
      const restore = useSnapshotURL(`http://127.0.0.1:${address.port}`, () => {
        if (normalized) for (const socket of server.clients) socket.send(JSON.stringify({ cmd: 'PONG' }))
      })
      server.on('connection', (socket) => {
        const first = ++connections === 1
        socket.once('message', () => {
          if (normalized) socket.send(JSON.stringify({ id: 'SPOT_BTC_USDT', cmd: 'SUBSCRIBE', success: true }))
          socket.send(JSON.stringify(depth(first ? 105 : 2, first ? 100 : 0)))
          sendGap = () => socket.send(JSON.stringify(depth(110, 109)))
        })
      })
      const options = { exchange: 'woo-x' as const, timeoutIntervalMS: 0, onError: (error: Error) => errors.push(error) }
      const messages = normalized
        ? streamNormalized({ ...options, symbols: ['SPOT_BTC_USDT'], withDisconnectMessages: withDisconnects }, normalizeBookChanges)
        : stream({ ...options, filters: [{ channel: 'orderbookupdate', symbols: ['SPOT_BTC_USDT'] }], withDisconnects })
      const output: any[] = []
      try {
        for await (const message of messages) {
          output.push(message)
          if (output.length === (normalized ? 2 : 1)) sendGap!()
          if (output.length === (normalized ? 4 : 2) + (withDisconnects ? 1 : 0)) break
        }
        if (withDisconnects) {
          const index = normalized ? 2 : 1
          assert.strictEqual(normalized ? output[index].type : output[index], normalized ? 'disconnect' : undefined)
          output.splice(index, 1)
        }
        if (normalized) {
          assert.deepStrictEqual(
            output.map((m) => m.isSnapshot),
            [true, false, true, false]
          )
          assert.deepStrictEqual(
            output.map((m) => m.bids),
            [100, 105, 0, 2].map((amount) => [{ price: 100, amount }])
          )
          assert.strictEqual(requests, 2)
        } else {
          assert.deepStrictEqual(
            output.map((m) => m.message),
            [depth(105, 100), depth(2, 0)]
          )
          assert.strictEqual(requests, 0)
        }
        assert.strictEqual(connections, 2)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
      } finally {
        await messages.return?.()
        restore()
        await cleanup()
        await new Promise<void>((resolve) => http.close(() => resolve()))
      }
    })
  }
}

test('WOO X normalized opt-out retains snapshot overlap suppression', { timeout: 10000 }, async () => {
  const errors: Error[] = [],
    { server, cleanup } = await createTestWebSocketServer('woo-x')
  const http = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ success: true, timestamp: 100, data: { bids: [{ price: '100', quantity: '100' }], asks: [] } }))
  })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const address = http.address()
  assert.ok(address && typeof address === 'object')
  const restore = useSnapshotURL(`http://127.0.0.1:${address.port}`, () => {
    for (const socket of server.clients) socket.send(JSON.stringify({ cmd: 'PONG' }))
  })
  server.on('connection', (socket) =>
    socket.once('message', () => {
      for (const [ts, prevTs] of [
        [99, 90],
        [105, 100],
        [110, 109]
      ]) {
        socket.send(
          JSON.stringify({
            topic: 'orderbookupdate@SPOT_BTC_USDT@50',
            ts: ts + 1000,
            data: { s: 'SPOT_BTC_USDT', ts, prevTs, bids: [['100', String(ts)]], asks: [] }
          })
        )
      }
    })
  )
  const messages = streamNormalized(
    {
      exchange: 'woo-x',
      symbols: ['SPOT_BTC_USDT'],
      timeoutIntervalMS: 0,
      validateSequence: false,
      onError: (error) => errors.push(error)
    },
    normalizeBookChanges
  )
  try {
    for (const amount of [100, 105, 110]) assert.deepStrictEqual((await messages.next()).value.bids, [{ price: 100, amount }])
    assert.deepStrictEqual(errors, [])
  } finally {
    await messages.return?.()
    restore()
    await cleanup()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }
})
