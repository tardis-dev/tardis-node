import { test } from 'node:test'
import { stream, streamNormalized, normalizeBookChanges, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

function update(sequence: number, symbol = 'XBTUSDTM') {
  return {
    type: 'message',
    topic: `/contractMarket/level2:${symbol}`,
    subject: 'level2',
    sn: sequence,
    data: { sequence, change: `100,buy,${sequence}`, timestamp: Date.now() }
  }
}
function snapshot(sequence: number) {
  return {
    type: 'message',
    generated: true,
    topic: '/contractMarket/level2Snapshot:XBTUSDTM',
    subject: 'level2Snapshot',
    code: '200000',
    data: { sequence, symbol: 'XBTUSDTM', bids: [[100, sequence]], asks: [], ts: Date.now() * 1000000 }
  }
}

for (const validateSequence of [undefined, true, false]) {
  test(
    `KuCoin Futures continuity and topic isolation: validation=${validateSequence ?? 'default'}`,
    { timeout: 10000 },
    async (context) => {
      const errors: Error[] = []
      const { server, wssURL, cleanup } = await createTestWebSocketServer()
      context.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
        assert.strictEqual(String(url), 'https://api-futures.kucoin.com/api/v1/bullet-public')
        assert.strictEqual(options?.method, 'POST')
        return Response.json({ data: { token: 'test', instanceServers: [{ endpoint: wssURL }] } })
      })
      const zeroPrice = update(102)
      zeroPrice.data.change = '0,buy,0'
      zeroPrice.sn = 999999 // Use data.sequence, not the envelope counter.
      const valid = [
        { type: 'welcome', id: 'test' },
        { type: 'ack', id: 'test' },
        { type: 'pong', id: 'test' },
        update(100),
        update(101),
        update(101),
        update(500, 'ETHUSDTM'),
        snapshot(50),
        { type: 'message', subject: 'match', topic: '/contractMarket/execution:XBTUSDTM', data: { sequence: 999999 } },
        { type: 'message', subject: 'tickerV2', topic: '/contractMarket/tickerV2:XBTUSDTM', data: { sequence: 999999 } },
        { type: 'message', subject: 'contractDetails', topic: '/contract/details:XBTUSDTM', data: { sequence: 999999 } },
        zeroPrice, // Price/size filtering must not skip continuity checks.
        update(501, 'ETHUSDTM')
      ]
      const gap = update(104)
      server.on('connection', (socket) =>
        socket.once('message', (bytes) => {
          const subscription = JSON.parse(bytes.toString())
          assert.strictEqual(subscription.topic, '/contractMarket/level2:ETHUSDTM,XBTUSDTM')
          for (const message of [...valid, gap]) socket.send(JSON.stringify(message))
        })
      )
      const feed = stream({
        exchange: 'kucoin-futures',
        filters: [{ channel: 'contractMarket/level2', symbols: ['XBTUSDTM', 'ETHUSDTM'] }],
        timeoutIntervalMS: 0,
        validateSequence,
        withDisconnects: true,
        onError: (error) => errors.push(error)
      })
      try {
        for (const message of valid) assert.deepStrictEqual((await feed.next()).value?.message, message)
        const next = (await feed.next()).value
        if (validateSequence === false) {
          assert.deepStrictEqual(next?.message, gap)
          assert.deepStrictEqual(errors, [])
        } else {
          assert.strictEqual(next, undefined)
          assert.strictEqual(errors.length, 1)
          assert.ok(errors[0] instanceof SequenceGapError)
          assert.strictEqual(errors[0].exchange, 'kucoin-futures')
          assert.strictEqual(errors[0].key, 'XBTUSDTM')
          assert.strictEqual(errors[0].expectedPreviousSequence, 102)
          assert.strictEqual(errors[0].previousSequence, 103)
          assert.strictEqual(errors[0].sequence, 104)
        }
      } finally {
        await feed.return?.()
        await cleanup()
      }
    }
  )
}

for (const normalized of [false, true]) {
  for (const withDisconnects of [false, true]) {
    test(
      `KuCoin Futures sequence recovery: normalized=${normalized}, disconnects=${withDisconnects}`,
      { timeout: 10000 },
      async (context) => {
        const errors: Error[] = []
        let connections = 0
        const { server, wssURL, cleanup } = await createTestWebSocketServer()
        context.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0]) => {
          if (String(url).endsWith('/v1/bullet-public'))
            return Response.json({ data: { token: 'test', instanceServers: [{ endpoint: wssURL }] } })
          assert.strictEqual(String(url), 'https://api-futures.kucoin.com/api/v1/level2/snapshot?symbol=XBTUSDTM')
          return Response.json({ code: '200000', data: snapshot(connections === 1 ? 100 : 0).data })
        })
        const initial = [snapshot(100), update(101), update(103)]
        const recovered = [snapshot(0), update(2)]
        server.on('connection', (socket) => {
          const first = ++connections === 1
          socket.once('message', () => {
            for (const message of first ? initial : recovered) socket.send(JSON.stringify(message))
          })
        })
        const options = { exchange: 'kucoin-futures' as const, timeoutIntervalMS: 0, onError: (error: Error) => errors.push(error) }
        const feed = normalized
          ? streamNormalized({ ...options, symbols: ['XBTUSDTM'], withDisconnectMessages: withDisconnects }, normalizeBookChanges)
          : stream({ ...options, filters: [{ channel: 'contractMarket/level2', symbols: ['XBTUSDTM'] }], withDisconnects })
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
              [100, 101, 0, 2].map((amount) => [{ price: 100, amount }])
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
      }
    )
  }
}

test('KuCoin Futures normalized opt-out keeps existing snapshot mapping across a gap', { timeout: 10000 }, async (context) => {
  const errors: Error[] = []
  const { server, wssURL, cleanup } = await createTestWebSocketServer()
  context.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0]) => {
    if (String(url).endsWith('/v1/bullet-public'))
      return Response.json({ data: { token: 'test', instanceServers: [{ endpoint: wssURL }] } })
    assert.strictEqual(String(url), 'https://api-futures.kucoin.com/api/v1/level2/snapshot?symbol=XBTUSDTM')
    return Response.json({ code: '200000', data: snapshot(100).data })
  })
  server.on('connection', (socket) =>
    socket.once('message', () => {
      for (const message of [snapshot(100), update(101), update(103)]) socket.send(JSON.stringify(message))
    })
  )
  const feed = streamNormalized(
    {
      exchange: 'kucoin-futures',
      symbols: ['XBTUSDTM'],
      timeoutIntervalMS: 0,
      validateSequence: false,
      onError: (error) => errors.push(error)
    },
    normalizeBookChanges
  )
  try {
    for (const amount of [100, 101, 103]) assert.deepStrictEqual((await feed.next()).value.bids, [{ price: 100, amount }])
    assert.deepStrictEqual(errors, [])
  } finally {
    await feed.return?.()
    await cleanup()
  }
})

test('KuCoin Futures rejects a depth topic without a symbol separator', { timeout: 10000 }, async (context) => {
  const errors: Error[] = []
  const { server, wssURL, cleanup } = await createTestWebSocketServer()
  context.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0]) => {
    assert.strictEqual(String(url), 'https://api-futures.kucoin.com/api/v1/bullet-public')
    return Response.json({ data: { token: 'test', instanceServers: [{ endpoint: wssURL }] } })
  })
  const first = update(100)
  const malformed = update(101)
  malformed.topic = '/contractMarket/level2'
  server.on('connection', (socket) =>
    socket.once('message', () => {
      for (const message of [first, malformed]) socket.send(JSON.stringify(message))
    })
  )
  const feed = stream({
    exchange: 'kucoin-futures',
    filters: [{ channel: 'contractMarket/level2', symbols: ['XBTUSDTM'] }],
    timeoutIntervalMS: 0,
    withDisconnects: true,
    onError: (error) => errors.push(error)
  })
  try {
    assert.deepStrictEqual((await feed.next()).value?.message, first)
    assert.strictEqual((await feed.next()).value, undefined)
    assert.strictEqual(errors.length, 1)
    assert.match(errors[0].message, /Unexpected Kucoin futures level2 topic/)
  } finally {
    await feed.return?.()
    await cleanup()
  }
})
