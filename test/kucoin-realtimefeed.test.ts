import { test } from 'node:test'
import { stream, streamNormalized, normalizeBookChanges, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

function update(sequenceStart: number, sequenceEnd: number, symbol = 'BTC-USDT') {
  return {
    type: 'message',
    topic: `/market/level2:${symbol}`,
    subject: 'trade.l2update',
    data: {
      symbol,
      sequenceStart,
      sequenceEnd,
      time: Date.now(),
      changes: { bids: [['100', String(sequenceEnd), String(sequenceEnd)]], asks: [] }
    }
  }
}
function snapshot(sequence: number) {
  return {
    type: 'message',
    generated: true,
    topic: '/market/level2Snapshot:BTC-USDT',
    subject: 'trade.l2Snapshot',
    code: '200000',
    data: { time: Date.now(), sequence: String(sequence), bids: [['100', String(sequence)]], asks: [] }
  }
}

for (const validateSequence of [undefined, true, false]) {
  test(`KuCoin range continuity and symbol isolation: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async (context) => {
    const errors: Error[] = []
    const { server, wssURL, cleanup } = await createTestWebSocketServer()
    context.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
      assert.strictEqual(String(url), 'https://api.kucoin.com/api/v1/bullet-public')
      assert.strictEqual(options?.method, 'POST')
      return Response.json({ data: { token: 'test', instanceServers: [{ endpoint: wssURL }] } })
    })
    const empty = update(111, 115)
    empty.data.changes.bids = []
    const valid = [
      { type: 'welcome', id: 'test' },
      { type: 'ack', id: 'test' },
      { type: 'pong', id: 'test' },
      update(100, 105),
      update(106, 110),
      update(106, 110),
      update(500, 501, 'ETH-USDT'),
      snapshot(50),
      { type: 'message', subject: 'trade.l3match', data: { symbol: 'BTC-USDT', sequenceStart: 9999, sequenceEnd: 10000 } },
      { type: 'message', subject: 'trade.ticker', data: { symbol: 'BTC-USDT', sequenceStart: 9999, sequenceEnd: 10000 } },
      empty, // Empty updates still advance the range.
      update(502, 505, 'ETH-USDT')
    ]
    const gap = update(117, 120)
    server.on('connection', (socket) =>
      socket.once('message', (bytes) => {
        const subscription = JSON.parse(bytes.toString())
        assert.strictEqual(subscription.topic, '/market/level2:BTC-USDT,ETH-USDT')
        for (const message of [...valid, gap]) socket.send(JSON.stringify(message))
      })
    )
    const feed = stream({
      exchange: 'kucoin',
      filters: [{ channel: 'market/level2', symbols: ['BTC-USDT', 'ETH-USDT'] }],
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
        assert.strictEqual(errors[0].exchange, 'kucoin')
        assert.strictEqual(errors[0].key, 'BTC-USDT')
        assert.strictEqual(errors[0].expectedPreviousSequence, 115)
        assert.strictEqual(errors[0].previousSequence, 116)
        assert.strictEqual(errors[0].sequence, 120)
      }
    } finally {
      await feed.return?.()
      await cleanup()
    }
  })
}

for (const normalized of [false, true]) {
  for (const withDisconnects of [false, true]) {
    test(`KuCoin sequence recovery: normalized=${normalized}, disconnects=${withDisconnects}`, { timeout: 10000 }, async (context) => {
      const errors: Error[] = []
      let connections = 0
      const { server, wssURL, cleanup } = await createTestWebSocketServer()
      context.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0]) => {
        if (String(url).endsWith('/v1/bullet-public'))
          return Response.json({ data: { token: 'test', instanceServers: [{ endpoint: wssURL }] } })
        assert.strictEqual(String(url), 'https://api.kucoin.com/api/v1/market/orderbook/level2_100?symbol=BTC-USDT')
        return Response.json({ code: '200000', data: snapshot(connections === 1 ? 100 : 0).data })
      })
      const initial = [snapshot(100), update(101, 105), update(107, 110)]
      const recovered = [snapshot(0), update(1, 2)]
      server.on('connection', (socket) => {
        const first = ++connections === 1
        socket.once('message', () => {
          for (const message of first ? initial : recovered) socket.send(JSON.stringify(message))
        })
      })
      const options = { exchange: 'kucoin' as const, timeoutIntervalMS: 0, onError: (error: Error) => errors.push(error) }
      const feed = normalized
        ? streamNormalized({ ...options, symbols: ['BTC-USDT'], withDisconnectMessages: withDisconnects }, normalizeBookChanges)
        : stream({ ...options, filters: [{ channel: 'market/level2', symbols: ['BTC-USDT'] }], withDisconnects })
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
            [100, 105, 0, 2].map((amount) => [{ price: 100, amount }])
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
    })
  }
}

test('KuCoin normalized opt-out keeps existing snapshot mapping across a gap', { timeout: 10000 }, async (context) => {
  const errors: Error[] = []
  const { server, wssURL, cleanup } = await createTestWebSocketServer()
  context.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0]) => {
    if (String(url).endsWith('/v1/bullet-public'))
      return Response.json({ data: { token: 'test', instanceServers: [{ endpoint: wssURL }] } })
    assert.strictEqual(String(url), 'https://api.kucoin.com/api/v1/market/orderbook/level2_100?symbol=BTC-USDT')
    return Response.json({ code: '200000', data: snapshot(100).data })
  })
  server.on('connection', (socket) =>
    socket.once('message', () => {
      for (const message of [snapshot(100), update(101, 105), update(107, 110)]) socket.send(JSON.stringify(message))
    })
  )
  const feed = streamNormalized(
    { exchange: 'kucoin', symbols: ['BTC-USDT'], timeoutIntervalMS: 0, validateSequence: false, onError: (error) => errors.push(error) },
    normalizeBookChanges
  )
  try {
    for (const amount of [100, 105, 110]) assert.deepStrictEqual((await feed.next()).value.bids, [{ price: 100, amount }])
    assert.deepStrictEqual(errors, [])
  } finally {
    await feed.return?.()
    await cleanup()
  }
})
