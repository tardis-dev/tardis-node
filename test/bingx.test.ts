import { gzipSync } from 'node:zlib'
import { test } from 'node:test'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'
import { normalizeTrades, normalizeBookChanges, normalizeBookTickers, stream, SequenceGapError } from '../dist/index.js'
import { BingxRealTimeFeed } from '../dist/realtimefeeds/bingx.js'
import type { Filter } from '../dist/types.js'

// Recorder captures with depth levels trimmed.
const fixtures: Record<string, any[]> = {
  bingx: [
    { code: 0, id: '1', msg: 'SUCCESS', timestamp: 1794990074978 },
    {
      code: 0,
      timestamp: 1794990074978,
      dataType: 'BTC-USDT@incrDepth',
      data: {
        action: 'all',
        lastUpdateId: 1101304,
        sourceUpdateId: 16609235752,
        bids: { '64619.92': '0.004298', '64617.87': '8.254757' },
        asks: { '65584.98': '0.000004', '65584.42': '0.000040' }
      }
    },
    {
      code: 0,
      data: {
        action: 'update',
        asks: { '65584.98': '0.000004', '65584.42': '0.000040' },
        bids: {},
        lastUpdateId: 1101305,
        sourceUpdateId: 16609235756
      },
      dataType: 'BTC-USDT@incrDepth',
      success: true,
      timestamp: 1794990075090
    },
    {
      code: 0,
      data: { E: 1794990075328, T: 1794990075307, e: 'trade', m: true, p: '64621.93', q: '0.006856', s: 'BTC-USDT', t: '248444076' },
      dataType: 'BTC-USDT@trade',
      success: true,
      timestamp: 1794990075328
    },
    {
      code: 0,
      data: { A: '0.004057', B: '0.007133', E: 1794990075389, a: '64621.94', b: '64621.92', e: 'bookTicker', s: 'BTC-USDT' },
      dataType: 'BTC-USDT@bookTicker',
      success: true,
      timestamp: 1794990075389
    },
    {
      code: 0,
      timestamp: 1794990076136,
      dataType: 'BTC-USDT@ticker',
      data: {
        e: '24hTicker',
        E: 1794990076134,
        s: 'BTC-USDT',
        p: 96.92,
        P: '0.15%',
        o: 64525.02,
        h: 65441.24,
        l: 63339.9,
        c: 64621.94,
        v: 2490.28,
        q: 160451750.55,
        O: 1794903676134,
        C: 1794990076134,
        A: 64621.94,
        a: 0.004057,
        B: 64621.92,
        b: 0.007133
      }
    }
  ]
}
const localTimestamp = new Date('2026-11-24T00:00:00Z')

for (const exchange of ['bingx'] as const) {
  test(`${exchange} trade side, book roles, timestamps and BBO`, () => {
    const messages = fixtures[exchange]
    const trades = normalizeTrades(exchange, localTimestamp)
    const rawTrade = messages.find((m: any) => m.dataType?.endsWith('@trade'))
    const [trade] = [...trades.map(rawTrade, localTimestamp)!]
    const raw = rawTrade.data
    assert.strictEqual(trade.side, 'sell')
    assert.strictEqual(trade.id, raw.t)
    assert.strictEqual(trade.amount, Number(raw.q))
    assert.strictEqual(trade.timestamp.valueOf(), raw.T)
    assert.strictEqual(trade.localTimestamp, localTimestamp)
    const buyer = { ...rawTrade, data: { ...raw, m: false } }
    assert.strictEqual([...trades.map(buyer, localTimestamp)!][0].side, 'buy')
    assert.strictEqual(trades.canHandle(messages[0]), false)
    const book = normalizeBookChanges(exchange, localTimestamp)
    const [snapshot, update] = messages.filter((m: any) => m.dataType?.endsWith('@incrDepth'))
    const [initial] = [...book.map(snapshot, localTimestamp)!]
    assert.strictEqual(initial.isSnapshot, true)
    assert.strictEqual(initial.timestamp.valueOf(), snapshot.timestamp)
    assert.strictEqual([...book.map(update, localTimestamp)!][0].isSnapshot, false)
    const deletion = { ...update, data: { ...update.data, bids: { '60000': '0' } } }
    assert.deepEqual([...book.map(deletion, localTimestamp)!][0].bids, [{ price: 60000, amount: 0 }])
    const rawBbo = messages.find((m: any) => m.dataType?.endsWith('@bookTicker'))
    const [bbo] = [...normalizeBookTickers(exchange, localTimestamp).map(rawBbo, localTimestamp)!]
    assert.strictEqual(bbo.bidPrice, Number(rawBbo.data.b))
    assert.strictEqual(bbo.askAmount, Number(rawBbo.data.A))
    assert.strictEqual(bbo.timestamp.valueOf(), rawBbo.data.E)
  })
}

for (const symbols of [undefined, []]) {
  test(`BingX rejects missing symbols (${JSON.stringify(symbols)})`, () => {
    class Feed extends BingxRealTimeFeed {
      subscriptions(filters: Filter<string>[]) {
        return this.mapToSubscribeMessages(filters)
      }
    }
    assert.throws(() => new Feed('bingx', [], 0).subscriptions([{ channel: 'trade', symbols }]), /requires explicitly specified symbols/)
  })
}

for (const exchange of ['bingx'] as const) {
  for (const validateSequence of [true, false]) {
    test(`${exchange} gzip heartbeat and sequence recovery (${validateSequence})`, { timeout: 15000 }, async () => {
      const { server, cleanup } = await createTestWebSocketServer(exchange)
      const errors: Error[] = []
      let connections = 0
      let pong = false
      const ping = { ping: '85181e7361b34b1f8d97cad15cefbd0a', time: '2026-11-27T17:21:51.374+0800' }
      const depth = (sequence: number, action: string) => ({
        code: 0,
        dataType: 'BTC-USDT@incrDepth',
        data: { action, lastUpdateId: sequence }
      })
      server.on('connection', (socket) => {
        connections++
        socket.on('message', (bytes) => {
          const sub = JSON.parse(bytes.toString())
          if (sub.pong !== undefined) {
            assert.deepEqual(sub, { pong: ping.ping, time: ping.time })
            pong = true
            return
          }
          assert.strictEqual(sub.reqType, 'sub')
          assert.strictEqual(sub.dataType, 'BTC-USDT@incrDepth')
          socket.send(gzipSync(JSON.stringify(ping)))
          for (const message of [depth(100, 'all'), depth(101, 'update'), depth(103, 'update')]) {
            socket.send(gzipSync(JSON.stringify(message)))
          }
        })
      })
      const feed = stream({
        exchange,
        filters: [{ channel: 'incrDepth', symbols: ['BTC-USDT'] }],
        timeoutIntervalMS: 0,
        validateSequence,
        withDisconnects: true,
        onError: (e) => errors.push(e)
      })
      try {
        assert.deepEqual((await feed.next()).value?.message, ping)
        assert.strictEqual((await feed.next()).value?.message.data.action, 'all')
        assert.strictEqual((await feed.next()).value?.message.data.lastUpdateId, 101)
        const next = (await feed.next()).value
        if (validateSequence) {
          assert.strictEqual(next, undefined)
          assert.ok(errors[0] instanceof SequenceGapError)
          assert.deepEqual((await feed.next()).value?.message, ping)
          assert.strictEqual((await feed.next()).value?.message.data.action, 'all')
          assert.strictEqual(connections, 2)
        } else {
          assert.strictEqual(next?.message.data.lastUpdateId, 103)
          assert.deepEqual(errors, [])
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
        assert.strictEqual(pong, true)
      } finally {
        await feed.return?.()
        await cleanup()
      }
    })
  }
}

for (const ping of ['Ping', { ping: 'heartbeat-only', time: '2026-11-27T17:21:51.374+0800' }]) {
  test(`BingX ${typeof ping === 'string' ? 'plain' : 'JSON'} heartbeats do not keep a stale feed alive`, { timeout: 5000 }, async () => {
    const { server, cleanup } = await createTestWebSocketServer('bingx')
    let pongReceived = false
    server.on('connection', (socket) => {
      const timer = setInterval(() => socket.send(gzipSync(typeof ping === 'string' ? ping : JSON.stringify(ping))), 10)
      socket.once('close', () => clearInterval(timer))
      socket.on('message', (bytes) => {
        const expected = typeof ping === 'string' ? 'Pong' : JSON.stringify({ pong: ping.ping, time: ping.time })
        if (bytes.toString() === expected) pongReceived = true
      })
    })
    const feed = stream({
      exchange: 'bingx',
      filters: [{ channel: 'trade', symbols: ['BTC-USDT'] }],
      timeoutIntervalMS: 80,
      withDisconnects: true
    })
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        (async () => {
          for await (const message of feed) {
            if (message === undefined) return
          }
          assert.fail('Feed ended without reporting a stale connection')
        })(),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Heartbeats prevented stale-feed timeout')), 1500)
        })
      ])
      assert.strictEqual(pongReceived, true)
    } finally {
      clearTimeout(deadline)
      await feed.return?.()
      await cleanup()
    }
  })
}

test('BingX preserves native book roles when replay starts between snapshots', () => {
  for (const exchange of ['bingx'] as const) {
    const mapper = normalizeBookChanges(exchange, localTimestamp)
    const [snapshot, update] = fixtures[exchange].filter((m: any) => m.dataType?.endsWith('@incrDepth'))
    assert.strictEqual([...mapper.map(update, localTimestamp)!][0].isSnapshot, false)
    assert.strictEqual([...mapper.map(snapshot, localTimestamp)!][0].isSnapshot, true)
    assert.strictEqual([...mapper.map(update, localTimestamp)!][0].isSnapshot, false)
    assert.strictEqual([...mapper.map({ ...update, dataType: 'ETH-USDT@incrDepth' }, localTimestamp)!][0].isSnapshot, false)
    assert.strictEqual([...normalizeBookChanges(exchange, localTimestamp).map(update, localTimestamp)!][0].isSnapshot, false)
  }
})

test('BingX spot book tickers preserve missing fields and zero amounts', () => {
  const mapper = normalizeBookTickers('bingx', localTimestamp)
  const bidMessage = {
    dataType: 'BTC-USDT@bookTicker',
    data: { e: 'bookTicker', E: localTimestamp.valueOf(), s: 'BTC-USDT', b: '100', B: '0' }
  }
  const [bidOnly] = [...mapper.map(bidMessage, localTimestamp)!]
  assert.strictEqual(bidOnly.bidPrice, 100)
  assert.strictEqual(bidOnly.bidAmount, 0)
  assert.strictEqual(bidOnly.askPrice, undefined)
  assert.strictEqual(bidOnly.askAmount, undefined)

  const askMessage = {
    dataType: 'BTC-USDT@bookTicker',
    data: { e: 'bookTicker', E: localTimestamp.valueOf(), s: 'BTC-USDT', a: '101', A: '0' }
  }
  const [askOnly] = [...mapper.map(askMessage, localTimestamp)!]
  assert.strictEqual(askOnly.bidPrice, undefined)
  assert.strictEqual(askOnly.bidAmount, undefined)
  assert.strictEqual(askOnly.askPrice, 101)
  assert.strictEqual(askOnly.askAmount, 0)
})

test('BingX spot preserves explicit zero prices and amounts', () => {
  const message = {
    dataType: 'BTC-USDT@bookTicker',
    data: { e: 'bookTicker', E: localTimestamp.valueOf(), s: 'BTC-USDT', b: '0', B: '0.00', a: '0.00', A: '0' }
  }
  const [ticker] = [...normalizeBookTickers('bingx', localTimestamp).map(message, localTimestamp)!]
  assert.strictEqual(ticker.bidPrice, 0)
  assert.strictEqual(ticker.bidAmount, 0)
  assert.strictEqual(ticker.askPrice, 0)
  assert.strictEqual(ticker.askAmount, 0)
})
