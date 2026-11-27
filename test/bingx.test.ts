import { gzipSync } from 'node:zlib'
import { test } from 'node:test'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'
import {
  normalizeTrades,
  normalizeBookChanges,
  normalizeBookTickers,
  normalizeDerivativeTickers,
  stream,
  SequenceGapError
} from '../dist/index.js'
import { BingxRealTimeFeed, BingxFuturesRealTimeFeed } from '../dist/realtimefeeds/bingx.js'
import type { Filter } from '../dist/types.js'

// Recorder captures with depth levels trimmed.
const fixtures: Record<string, any[]> = {
  bingx: [
    {
      code: 0,
      id: '1',
      msg: 'SUCCESS',
      timestamp: 1794990074978
    },
    {
      code: 0,
      timestamp: 1794990074978,
      dataType: 'BTC-USDT@incrDepth',
      data: {
        action: 'all',
        lastUpdateId: 1101304,
        sourceUpdateId: 16609235752,
        bids: {
          '64619.92': '0.004298',
          '64617.87': '8.254757'
        },
        asks: {
          '65584.98': '0.000004',
          '65584.42': '0.000040'
        }
      }
    },
    {
      code: 0,
      data: {
        action: 'update',
        asks: {
          '65584.98': '0.000004',
          '65584.42': '0.000040'
        },
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
      data: {
        E: 1794990075328,
        T: 1794990075307,
        e: 'trade',
        m: true,
        p: '64621.93',
        q: '0.006856',
        s: 'BTC-USDT',
        t: '248444076'
      },
      dataType: 'BTC-USDT@trade',
      success: true,
      timestamp: 1794990075328
    },
    {
      code: 0,
      data: {
        A: '0.004057',
        B: '0.007133',
        E: 1794990075389,
        a: '64621.94',
        b: '64621.92',
        e: 'bookTicker',
        s: 'BTC-USDT'
      },
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
  ],
  'bingx-futures': [
    {
      id: '1',
      code: 0,
      msg: '',
      dataType: '',
      data: null
    },
    {
      code: 0,
      dataType: 'BTC-USDT@incrDepth',
      data: {
        action: 'all',
        lastUpdateId: 789424784,
        time: 1795426539740,
        bids: [
          ['61573.7', '28.6485'],
          ['61573.5', '0.0134']
        ],
        asks: [
          ['61573.8', '18.7314'],
          ['61574.0', '7.5855']
        ]
      }
    },
    {
      code: 0,
      dataType: 'BTC-USDT@incrDepth',
      data: {
        action: 'update',
        lastUpdateId: 789424785,
        time: 1795426539775,
        bids: [
          ['61573.7', '0.0000'],
          ['61573.5', '0.0000']
        ],
        asks: [
          ['61816.9', '0.0000'],
          ['61815.1', '0.0000']
        ]
      }
    },
    {
      code: 0,
      dataType: 'BTC-USDT@trade',
      data: [
        {
          t: '766441347',
          q: '0.0004',
          p: '61571.2',
          T: 1795426539746,
          m: true,
          s: 'BTC-USDT'
        }
      ]
    },
    {
      code: 0,
      dataType: 'NCSKMSFT2USD-USDT@trade',
      data: [
        {
          t: '139498775',
          q: '0.006',
          p: '500.43',
          T: 1795426540214,
          m: true,
          s: 'NCSKMSFT2USD-USDT'
        },
        {
          t: '139498776',
          q: '0.005',
          p: '500.44',
          T: 1795426540214,
          m: false,
          s: 'NCSKMSFT2USD-USDT'
        }
      ]
    },
    {
      code: 0,
      dataType: 'BTC-USDT@bookTicker',
      data: {
        e: 'bookTicker',
        u: 267380417,
        E: 1795426539790,
        T: 1795426539655,
        s: 'BTC-USDT',
        b: '61571.2',
        B: '24.7217',
        a: '61571.3',
        A: '21.7630'
      }
    },
    {
      code: 0,
      dataType: 'BTC-USDT@ticker',
      data: {
        e: '24hTicker',
        E: 1795426540703,
        s: 'BTC-USDT',
        p: '12.1',
        P: '0.02',
        c: '61572.8',
        L: '0.0008',
        h: '61945.5',
        l: '59885.9',
        v: '23978.1900',
        q: '1464540629.71',
        o: '61560.7',
        O: 1795426363333,
        C: 1795426540341,
        A: '61581.9',
        a: '9.0777',
        B: '61572.7',
        b: '46.2796'
      }
    },
    {
      code: 0,
      dataType: 'BTC-USDT@premiumIndex',
      generated: true,
      data: {
        symbol: 'BTC-USDT',
        markPrice: '61581.6',
        indexPrice: '61607.7',
        lastFundingRate: '0.00004100',
        nextFundingTime: 1795449600000,
        fundingIntervalHours: 8,
        minFundingRate: '-0.003000',
        maxFundingRate: '0.003000',
        updateTime: 1795420800000
      }
    },
    {
      code: 0,
      dataType: 'BTC-USDT@openInterest',
      generated: true,
      data: {
        openInterest: '613901942.7',
        symbol: 'BTC-USDT',
        time: 1795426541142
      }
    },
    {
      code: 0,
      dataType: 'BTC-USDT@markPrice',
      data: {
        e: 'markPriceUpdate',
        E: 1795426540489,
        s: 'BTC-USDT',
        p: '61580.8'
      }
    }
  ]
}
const localTimestamp = new Date('2026-11-24T00:00:00Z')

for (const exchange of ['bingx', 'bingx-futures'] as const) {
  test(`${exchange} trade side, book roles, timestamps and BBO`, () => {
    const messages = fixtures[exchange]
    const trades = normalizeTrades(exchange, localTimestamp)
    const rawTrade = messages.find((m: any) => m.dataType?.endsWith('@trade'))
    const [trade] = [...trades.map(rawTrade, localTimestamp)!]
    const raw = exchange === 'bingx' ? rawTrade.data : rawTrade.data[0]
    assert.strictEqual(trade.side, 'sell')
    assert.strictEqual(trade.id, raw.t)
    assert.strictEqual(trade.amount, Number(raw.q))
    assert.strictEqual(trade.timestamp.valueOf(), raw.T)
    assert.strictEqual(trade.localTimestamp, localTimestamp)
    const buyer = { ...rawTrade, data: exchange === 'bingx' ? { ...raw, m: false } : [{ ...raw, m: false }] }
    assert.strictEqual([...trades.map(buyer, localTimestamp)!][0].side, 'buy')
    assert.strictEqual(trades.canHandle(messages[0]), false)
    const book = normalizeBookChanges(exchange, localTimestamp)
    const [snapshot, update] = messages.filter((m: any) => m.dataType?.endsWith('@incrDepth'))
    const [initial] = [...book.map(snapshot, localTimestamp)!]
    assert.strictEqual(initial.isSnapshot, true)
    assert.strictEqual(initial.timestamp.valueOf(), exchange === 'bingx' ? snapshot.timestamp : snapshot.data.time)
    assert.strictEqual([...book.map(update, localTimestamp)!][0].isSnapshot, false)
    const deletion = { ...update, data: { ...update.data, bids: exchange === 'bingx' ? { '60000': '0' } : [['60000', '0']] } }
    assert.deepEqual([...book.map(deletion, localTimestamp)!][0].bids, [{ price: 60000, amount: 0 }])
    const rawBbo = messages.find((m: any) => m.dataType?.endsWith('@bookTicker'))
    const [bbo] = [...normalizeBookTickers(exchange, localTimestamp).map(rawBbo, localTimestamp)!]
    assert.strictEqual(bbo.bidPrice, Number(rawBbo.data.b))
    assert.strictEqual(bbo.askAmount, Number(rawBbo.data.A))
    assert.strictEqual(bbo.timestamp.valueOf(), exchange === 'bingx' ? rawBbo.data.E : rawBbo.data.T)
  })
}

test('BingX futures caches side channels, preserves zero values and uses markPrice timestamps', () => {
  const mapper = normalizeDerivativeTickers('bingx-futures', localTimestamp)
  const messages = fixtures['bingx-futures']
  for (const message of messages.filter((m: any) => /@(ticker|premiumIndex|openInterest)$/.test(m.dataType))) {
    assert.deepEqual([...mapper.map(message, localTimestamp)!], [])
  }
  const mark = messages.find((m: any) => m.dataType?.endsWith('@markPrice'))
  const [ticker] = [...mapper.map(mark, localTimestamp)!]
  assert.strictEqual(ticker.markPrice, 61580.8)
  assert.strictEqual(ticker.lastPrice, 61572.8)
  assert.strictEqual(ticker.indexPrice, 61607.7)
  assert.strictEqual(ticker.openInterest, 613901942.7)
  assert.strictEqual(ticker.fundingRate, 0.000041)
  assert.strictEqual(ticker.fundingTimestamp?.valueOf(), 1795449600000)
  assert.strictEqual(ticker.timestamp.valueOf(), mark.data.E)
  for (const [channel, field] of [
    ['premiumIndex', 'lastFundingRate'],
    ['openInterest', 'openInterest']
  ] as const) {
    const message = messages.find((message: any) => message.dataType?.endsWith(`@${channel}`))
    assert.deepEqual([...mapper.map({ ...message, data: { ...message.data, [field]: '0' } }, localTimestamp)!], [])
  }
  const [zero] = [...mapper.map(mark, localTimestamp)!]
  assert.strictEqual(zero.fundingRate, 0)
  assert.strictEqual(zero.openInterest, 0)
  assert.strictEqual(zero.indexPrice, 61607.7)
  assert.deepEqual([...mapper.map(mark, localTimestamp)!], [])
})

for (const symbols of [undefined, []]) {
  test(`BingX rejects missing symbols (${JSON.stringify(symbols)})`, () => {
    class Feed extends BingxRealTimeFeed {
      subscriptions(filters: Filter<string>[]) {
        return this.mapToSubscribeMessages(filters)
      }
    }
    assert.throws(() => new Feed('bingx', [], 0).subscriptions([{ channel: 'trade', symbols }]), /requires explicitly specified symbols/)
    class Futures extends BingxFuturesRealTimeFeed {
      feeds(filters: Filter<string>[]) {
        return [...this._getRealTimeFeeds('bingx-futures', filters)]
      }
    }
    assert.throws(
      () => new Futures('bingx-futures', [], 0).feeds([{ channel: 'openInterest', symbols }]),
      /requires explicitly specified symbols/
    )
  })
}

for (const exchange of ['bingx', 'bingx-futures'] as const) {
  for (const validateSequence of [true, false]) {
    test(`${exchange} gzip heartbeat and sequence recovery (${validateSequence})`, { timeout: 15000 }, async () => {
      const { server, cleanup } = await createTestWebSocketServer(exchange)
      const errors: Error[] = []
      let connections = 0
      let pong = false
      const ping = exchange === 'bingx' ? { ping: '85181e7361b34b1f8d97cad15cefbd0a', time: '2026-11-27T17:21:51.374+0800' } : 'Ping'
      const depth = (sequence: number, action: string) => ({
        code: 0,
        dataType: 'BTC-USDT@incrDepth',
        data: { action, lastUpdateId: sequence }
      })
      server.on('connection', (socket) => {
        connections++
        socket.on('message', (bytes) => {
          if (bytes.toString() === 'Pong') {
            assert.strictEqual(ping, 'Ping')
            pong = true
            return
          }
          const sub = JSON.parse(bytes.toString())
          if (typeof ping !== 'string' && sub.pong !== undefined) {
            assert.deepEqual(sub, { pong: ping.ping, time: ping.time })
            pong = true
            return
          }
          assert.strictEqual(sub.reqType, 'sub')
          assert.strictEqual(sub.dataType, 'BTC-USDT@incrDepth')
          socket.send(gzipSync(typeof ping === 'string' ? ping : JSON.stringify(ping)))
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
        if (exchange === 'bingx' && validateSequence) {
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
  for (const exchange of ['bingx', 'bingx-futures'] as const) {
    const mapper = normalizeBookChanges(exchange, localTimestamp)
    const [snapshot, update] = fixtures[exchange].filter((m: any) => m.dataType?.endsWith('@incrDepth'))
    assert.strictEqual([...mapper.map(update, localTimestamp)!][0].isSnapshot, false)
    assert.strictEqual([...mapper.map(snapshot, localTimestamp)!][0].isSnapshot, true)
    assert.strictEqual([...mapper.map(update, localTimestamp)!][0].isSnapshot, false)
    assert.strictEqual([...mapper.map({ ...update, dataType: 'ETH-USDT@incrDepth' }, localTimestamp)!][0].isSnapshot, false)
    assert.strictEqual([...normalizeBookChanges(exchange, localTimestamp).map(update, localTimestamp)!][0].isSnapshot, false)
  }
})

test('BingX futures REST envelopes survive paused markets and per-symbol errors', { timeout: 10000 }, async () => {
  const { createServer } = await import('node:http')
  const { once } = await import('node:events')
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url!)
    response.setHeader('content-type', 'application/json')
    const url = new URL(request.url!, 'http://localhost')
    const symbol = url.searchParams.get('symbol')
    const result = url.pathname.endsWith('premiumIndex')
      ? {
          code: 0,
          data: [
            { symbol: 'SOL-USDT' },
            { symbol: 'BTC-USDT', indexPrice: '60001', lastFundingRate: '0', nextFundingTime: 1795449600000 },
            { symbol: 'ETH-USDT' }
          ]
        }
      : url.pathname.endsWith('contracts')
        ? {
            code: 0,
            data: [
              { symbol: 'BAD-USDT', status: 1 },
              { symbol: 'PAUSED-USDT', status: 25 },
              { symbol: 'RACE-USDT', status: 1 },
              { symbol: 'BTC-USDT', status: 1 },
              { symbol: 'SOL-USDT', status: 1 }
            ]
          }
        : symbol === 'BAD-USDT'
          ? { code: 100400, msg: 'invalid symbol' }
          : symbol === 'RACE-USDT'
            ? { code: 109415, msg: 'paused market' }
            : { code: 0, data: { symbol, openInterest: '0', time: 1795426541142 } }
    response.end(JSON.stringify(result))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  class Feed extends BingxFuturesRealTimeFeed {
    protected readonly httpURL = `http://127.0.0.1:${(address as { port: number }).port}`
  }
  const errors: Error[] = []
  const feed = new Feed(
    'bingx-futures',
    [
      { channel: 'premiumIndex', symbols: ['BTC-USDT', 'BTC-USDT'] },
      { channel: 'premiumIndex', symbols: ['ETH-USDT', 'BTC-USDT'] },
      { channel: 'openInterest', symbols: ['BAD-USDT', 'PAUSED-USDT', 'MISSING-USDT', 'RACE-USDT', 'BTC-USDT'] }
    ],
    0,
    (error) => errors.push(error)
  )[Symbol.asyncIterator]()
  try {
    const messages = [(await feed.next()).value, (await feed.next()).value, (await feed.next()).value]
    messages.sort((a, b) => a.dataType.localeCompare(b.dataType))
    assert.deepEqual(messages[0], {
      code: 0,
      dataType: 'BTC-USDT@openInterest',
      generated: true,
      data: { symbol: 'BTC-USDT', openInterest: '0', time: 1795426541142 }
    })
    assert.strictEqual(messages[1].dataType, 'BTC-USDT@premiumIndex')
    assert.strictEqual(messages[1].generated, true)
    assert.strictEqual(messages[1].data.lastFundingRate, '0')
    assert.strictEqual(messages[2].dataType, 'ETH-USDT@premiumIndex')
    assert.strictEqual(errors.length, 1)
    assert.match(errors[0].message, /BAD-USDT.*100400/)
    assert.strictEqual(requests.length, 5)
    assert.ok(requests.includes('/openApi/swap/v2/quote/contracts'))
    assert.ok(requests.every((request) => !/PAUSED-USDT|MISSING-USDT|SOL-USDT/.test(request)))
  } finally {
    await feed.return?.()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('BingX futures refreshes requested OI symbols and recovers after discovery fails', { timeout: 10000 }, async (context) => {
  const { setTimeout: sleep } = await import('node:timers/promises')
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let phase = 0
  const requests: { phase: number; symbol: string }[] = []
  const errors: Error[] = []
  let reportError!: (error: Error) => void
  const reportedError = new Promise<Error>((resolve) => {
    reportError = resolve
  })
  context.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/contracts')) {
      return Response.json({
        code: phase === 2 ? 100500 : 0,
        data:
          phase === 2
            ? null
            : [
                { symbol: 'BTC-USDT', status: phase === 1 ? 25 : 1 },
                { symbol: 'ETH-USDT', status: phase === 1 ? 1 : 25 },
                { symbol: 'SOL-USDT', status: 1 }
              ]
      })
    }
    const symbol = url.searchParams.get('symbol')!
    requests.push({ phase, symbol })
    return Response.json({ code: 0, data: { symbol, openInterest: '100', time: localTimestamp.valueOf() } })
  })
  const feed = new BingxFuturesRealTimeFeed(
    'bingx-futures',
    [{ channel: 'openInterest', symbols: ['BTC-USDT', 'ETH-USDT'] }],
    0,
    (error) => {
      errors.push(error)
      reportError(error)
    }
  )[Symbol.asyncIterator]()
  try {
    assert.strictEqual((await feed.next()).value.dataType, 'BTC-USDT@openInterest')
    await sleep(10)
    phase = 1
    context.mock.timers.tick(30000)
    assert.strictEqual((await feed.next()).value.dataType, 'ETH-USDT@openInterest')
    await sleep(10)
    phase = 2
    context.mock.timers.tick(30000)
    await reportedError
    await sleep(10)
    phase = 3
    context.mock.timers.tick(30000)
    assert.strictEqual((await feed.next()).value.dataType, 'BTC-USDT@openInterest')
    assert.deepEqual(requests, [
      { phase: 0, symbol: 'BTC-USDT' },
      { phase: 1, symbol: 'ETH-USDT' },
      { phase: 3, symbol: 'BTC-USDT' }
    ])
    assert.strictEqual(errors.length, 1)
  } finally {
    await feed.return?.()
  }
})

for (const response of [
  { code: 109429, msg: 'rate limited', data: null },
  { code: 109429, msg: 'rate limited', data: [] },
  { code: 109429, msg: 'rate limited', data: [{ symbol: 'BTC-USDT' }] },
  { code: 0, msg: 'invalid payload', data: null },
  { code: 0, msg: 'invalid payload', data: {} }
]) {
  test(`BingX premiumIndex reports invalid responses (${response.code}, ${JSON.stringify(response.data)})`, { timeout: 5000 }, async () => {
    const { createServer } = await import('node:http')
    const { once } = await import('node:events')
    const server = createServer((_request, output) => {
      output.setHeader('content-type', 'application/json')
      output.end(JSON.stringify(response))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    class Feed extends BingxFuturesRealTimeFeed {
      protected readonly httpURL = `http://127.0.0.1:${(address as { port: number }).port}`
    }
    let reportError!: (error: Error) => void
    const reportedError = new Promise<Error>((resolve) => {
      reportError = resolve
    })
    const feed = new Feed('bingx-futures', [{ channel: 'premiumIndex', symbols: ['BTC-USDT'] }], 0, reportError)[Symbol.asyncIterator]()
    const next = feed.next()
    try {
      const error = await reportedError
      assert.strictEqual(error.message, `BingX premiumIndex: ${response.code} ${response.msg}`)
    } finally {
      await feed.return?.()
      assert.strictEqual((await next).done, true)
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}

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

test('BingX futures retains zero-price empty-side handling', () => {
  const message = {
    dataType: 'NCSINIFTY52USD-USDT@bookTicker',
    data: {
      e: 'bookTicker',
      s: 'NCSINIFTY52USD-USDT',
      E: 1795518326884,
      T: 1795518326886,
      b: '25000.00',
      B: '3.7144000',
      a: '0.00',
      A: '0.0000000'
    }
  }
  const [ticker] = [...normalizeBookTickers('bingx-futures', localTimestamp).map(message, localTimestamp)!]
  assert.strictEqual(ticker.bidPrice, 25000)
  assert.strictEqual(ticker.bidAmount, 3.7144)
  assert.strictEqual(ticker.askPrice, undefined)
  assert.strictEqual(ticker.askAmount, undefined)

  const [emptyBook] = [
    ...normalizeBookTickers('bingx-futures', localTimestamp).map(
      { ...message, data: { ...message.data, b: '0.00', B: '0.0000000' } },
      localTimestamp
    )!
  ]
  assert.strictEqual(emptyBook.bidPrice, undefined)
  assert.strictEqual(emptyBook.bidAmount, undefined)
  assert.strictEqual(emptyBook.askPrice, undefined)
  assert.strictEqual(emptyBook.askAmount, undefined)
})
