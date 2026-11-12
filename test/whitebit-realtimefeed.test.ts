import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { WebSocketServer } from 'ws'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'
import {
  init,
  normalizeTrades,
  normalizeBookChanges,
  normalizeBookTickers,
  normalizeDerivativeTickers,
  replay,
  replayNormalized,
  stream,
  streamNormalized,
  SequenceGapError
} from '../dist/index.js'
import type { Filter } from '../dist/types.js'
import { WhiteBitRealTimeFeed, WhiteBitWebSocketRealTimeFeed } from '../dist/realtimefeeds/whitebit.js'

for (const validateSequence of [undefined, false]) {
  test(`WhiteBIT forwards stream errors: validateSequence=${validateSequence}`, { timeout: 10000 }, async () => {
    const { server, cleanup } = await createTestWebSocketServer('whitebit')
    const errors: Error[] = []
    const snapshot = { method: 'depth_update', params: [true, { update_id: 100, bids: [], asks: [] }, 'BTC_USDT'] }
    const error = { error: { code: 1, message: 'Subscription failed' }, id: 1 }
    server.on('connection', (socket) =>
      socket.once('message', () => {
        socket.send(JSON.stringify(snapshot))
        socket.send(JSON.stringify(error))
      })
    )
    const messages = stream({
      exchange: 'whitebit',
      filters: [{ channel: 'depth_update', symbols: ['BTC_USDT'] }],
      timeoutIntervalMS: 0,
      validateSequence,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })
    try {
      assert.deepStrictEqual((await messages.next()).value?.message, snapshot)
      assert.strictEqual((await messages.next()).value, undefined)
      assert.strictEqual(errors.length, 1)
      assert.ok(errors[0].message.includes('Subscription failed'))
    } finally {
      await messages.return?.()
      await cleanup()
    }
  })
}

class TestWhiteBitWebSocketFeed extends WhiteBitWebSocketRealTimeFeed {
  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }
  parse(message: string) {
    return this.parseMessage(Buffer.from(message))
  }
}

class TestWhiteBitFeed extends WhiteBitRealTimeFeed {
  protected readonly httpURL: string
  constructor(filters: Filter<string>[], httpURL: string) {
    super('whitebit', filters, undefined)
    this.httpURL = httpURL
  }
}

test('WhiteBIT subscriptions use native methods and one complete market list for replacement channels', () => {
  const feed = new TestWhiteBitWebSocketFeed('whitebit', [], undefined)
  assert.deepStrictEqual(
    feed.map([
      { channel: 'depth_update', symbols: ['BTC_PERP', 'ETH_PERP'] },
      { channel: 'bookTicker_update', symbols: ['BTC_PERP'] },
      { channel: 'trades_update', symbols: ['BTC_PERP', 'ETH_PERP'] },
      { channel: 'premiumIndex_update', symbols: ['BTC_PERP', 'ETH_PERP'] }
    ]),
    [
      { id: 1, method: 'depth_subscribe', params: ['BTC_PERP', 100, '0', true] },
      { id: 2, method: 'depth_subscribe', params: ['ETH_PERP', 100, '0', true] },
      { id: 3, method: 'bookTicker_subscribe', params: ['BTC_PERP'] },
      { id: 4, method: 'trades_subscribe', params: ['BTC_PERP', 'ETH_PERP'] },
      { id: 5, method: 'premiumIndex_subscribe', params: ['BTC_PERP', 'ETH_PERP'] }
    ]
  )
})

test('WhiteBIT decodes numeric trade timestamps and rounds normalized microseconds', () => {
  const feed = new TestWhiteBitWebSocketFeed('whitebit', [], undefined)
  const message = feed.parse(
    '{"method":"trades_update","params":["BTC_PERP",[{"id":24449944864,"time":1793089243.4692869,"price":"100","amount":"1","type":"buy"}]],"id":null}'
  )
  const [trade] = normalizeTrades('whitebit', new Date()).map(message, new Date())!
  assert.strictEqual(message.params[1][0].id, 24449944864)
  assert.strictEqual(message.params[1][0].time, 1793089243.4692869)
  assert.strictEqual(trade.id, '24449944864')
  assert.strictEqual(trade.timestamp.valueOf(), 1793089243469)
  assert.strictEqual(trade.timestamp.μs, 287)
})

test('WhiteBIT rounds depth, BBO and premium-index timestamps without changing counters or funding milliseconds', () => {
  const feed = new TestWhiteBitWebSocketFeed('whitebit', [], undefined)
  const localTimestamp = new Date()
  const depth = feed.parse(
    '{"params":[true,{"timestamp":1793015153.5139771,"event_time":1793015159.1234569,"update_id":25167412357,"bids":[],"asks":[]},"BTC_PERP"],"method":"depth_update","id":null}'
  )
  assert.strictEqual(depth.params[1].timestamp, 1793015153.5139771)
  assert.strictEqual(depth.params[1].event_time, 1793015159.1234569)
  assert.strictEqual(depth.params[1].update_id, 25167412357)
  const [book] = normalizeBookChanges('whitebit', localTimestamp).map(depth, localTimestamp)!
  assert.strictEqual(book.timestamp.valueOf(), 1793015153513)
  assert.strictEqual(book.timestamp.μs, 977)

  const bbo = feed.parse(
    '{"method":"bookTicker_update","params":[[1793089243.4692869,1793089243.4692879,"BTC_PERP",25167412357,"100","1","101","2"],[1793089244,1793089244.1,"XAU_PERP",25167412358,"4000","1","4001","2"]],"id":null}'
  )
  assert.deepStrictEqual(
    bbo.params.map((record: any[]) => record.slice(0, 4)),
    [
      [1793089243.4692869, 1793089243.4692879, 'BTC_PERP', 25167412357],
      [1793089244, 1793089244.1, 'XAU_PERP', 25167412358]
    ]
  )
  const tickers = [...normalizeBookTickers('whitebit', localTimestamp).map(bbo, localTimestamp)!]
  assert.strictEqual(tickers[0].timestamp.μs, 287)
  assert.strictEqual(tickers[1].timestamp.valueOf(), 1793089244000)
  assert.strictEqual(tickers[1].timestamp.μs, 0)

  const premium = feed.parse(
    '{"id":null,"params":["BTC_PERP","100","101","0.0001",1793097600000,1793089243.4692869],"method":"premiumIndex_update"}'
  )
  assert.strictEqual(premium.params[4], 1793097600000)
  assert.strictEqual(premium.params[5], 1793089243.4692869)
  const [ticker] = normalizeDerivativeTickers('whitebit', localTimestamp).map(premium, localTimestamp)!
  assert.strictEqual(ticker.timestamp.valueOf(), 1793089243469)
  assert.strictEqual(ticker.timestamp.μs, 287)
  assert.strictEqual(ticker.fundingTimestamp!.valueOf(), 1793097600000)
  assert.strictEqual(ticker.localTimestamp, localTimestamp)
  assert.deepStrictEqual(
    feed.parse('{"id":1,"result":{"message":"Example: 1793089243.4692869, keep \\"quoted\\" text","price":"100.1234567"}}'),
    { id: 1, result: { message: 'Example: 1793089243.4692869, keep "quoted" text', price: '100.1234567' } }
  )
})

test('WhiteBIT splits spot and perpetual markets into batches without replacing other subscriptions', { timeout: 10000 }, async () => {
  const server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const originalURL = process.env.WSS_URL_WHITEBIT
  process.env.WSS_URL_WHITEBIT = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
  const subscriptions: any[][] = []
  server.on('connection', (socket) => {
    const messages: any[] = []
    subscriptions.push(messages)
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString())
      messages.push(message)
      socket.send(JSON.stringify({ id: message.id, error: null, result: { status: 'success' } }))
    })
  })
  const spots = Array.from({ length: 51 }, (_, index) => `COIN${index}_USDT`)
  const perpetuals = ['BTC_PERP', 'XAU_PERP', ...Array.from({ length: 49 }, (_, index) => `COIN${index}_PERP`)]
  const symbols = [...spots, ...perpetuals]
  const iterator = stream({
    exchange: 'whitebit',
    filters: [
      { channel: 'depth_update', symbols },
      { channel: 'trades_update', symbols: spots.map((symbol) => symbol.toLowerCase()) },
      { channel: 'trades_update', symbols: [...perpetuals, spots[0].toLowerCase()] },
      { channel: 'bookTicker_update', symbols },
      { channel: 'premiumIndex_update', symbols: perpetuals }
    ]
  })
  const consume = (async () => {
    for await (const _ of iterator) {
    }
  })()
  try {
    while (subscriptions.flat().length < 210) {
      await sleep(10)
    }
    assert.strictEqual(subscriptions.length, 4)
    const subscribedTrades: string[] = []
    for (const connection of subscriptions) {
      const trades = connection.filter((message) => message.method === 'trades_subscribe')
      assert.strictEqual(trades.length, 1)
      assert.ok(trades[0].params.length <= 50)
      assert.strictEqual(new Set(trades[0].params.map((symbol: string) => symbol.endsWith('_PERP'))).size, 1)
      subscribedTrades.push(...trades[0].params)
      assert.strictEqual(new Set(connection.map(({ id }) => id)).size, connection.length)
    }
    assert.deepStrictEqual(subscribedTrades.sort(), symbols.sort())
    server.clients.values().next().value!.terminate()
    while (subscriptions.flat().length < 420) {
      await sleep(10)
    }
    assert.strictEqual(subscriptions.length, 8)
    assert.deepStrictEqual(
      subscriptions
        .slice(4)
        .flatMap((messages) => messages.filter(({ method }) => method === 'trades_subscribe').flatMap(({ params }) => params))
        .sort(),
      symbols.sort()
    )
  } finally {
    await iterator.return!()
    await consume
    if (originalURL === undefined) {
      delete process.env.WSS_URL_WHITEBIT
    } else {
      process.env.WSS_URL_WHITEBIT = originalURL
    }
    for (const socket of server.clients) {
      socket.terminate()
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('WhiteBIT rejects missing or empty WebSocket symbols', async () => {
  for (const symbols of [undefined, []]) {
    const feed = new WhiteBitRealTimeFeed('whitebit', [{ channel: 'depth_update', symbols }], undefined)
    await assert.rejects(feed[Symbol.asyncIterator]().next(), /requires explicitly specified symbols/)
  }
})

test('WhiteBIT REST streaming preserves the recorder envelope and respects requested symbols', { timeout: 10000 }, async () => {
  const markets = [
    { ticker_id: 'BTC_PERP', open_interest: '10' },
    { ticker_id: 'XAU_PERP', open_interest: '20' }
  ]
  let requests = 0
  const server = createServer((request, response) => {
    assert.strictEqual(request.url, '/futures')
    requests++
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ success: true, result: markets }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const cases = [
      { filters: [{ channel: 'futures_update' }], expected: markets },
      { filters: [{ channel: 'futures_update', symbols: ['xau_perp'] }], expected: [markets[1]] },
      {
        filters: [{ channel: 'futures_update', symbols: ['BTC_PERP'] }, { channel: 'futures_update' }],
        expected: markets
      }
    ]
    for (const { filters, expected } of cases) {
      const feed = new TestWhiteBitFeed(filters, url)
      const iterator = feed[Symbol.asyncIterator]()
      for (const market of expected) {
        const { value } = await iterator.next()
        assert.deepStrictEqual(value, { method: 'futures_update', params: [market.ticker_id, market], id: null, generated: true })
      }
      await iterator.return()
    }
    assert.strictEqual(requests, cases.length)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('WhiteBIT derivative ticker partials preserve zero and emit on premium-index timestamps', () => {
  const mapper = normalizeDerivativeTickers('whitebit', new Date())
  const localTimestamp = new Date()
  const map = (message: any) => [...mapper.map(message, localTimestamp)!]
  assert.deepStrictEqual(map({ method: 'futures_update', params: ['BTC_PERP', { open_interest: '10' }] }), [])
  const premium = { method: 'premiumIndex_update', params: ['BTC_PERP', '100', '101', '0.01', 1793030400000, 1793015160.123456] }
  assert.strictEqual(map(premium)[0].openInterest, 10)
  assert.deepStrictEqual(map({ method: 'futures_update', params: ['BTC_PERP', { open_interest: '0', mark_price: '1' }] }), [])
  premium.params = ['BTC_PERP', '100', '101', '0', 1793030400000, 1793015160.623456]
  const [updated] = map(premium)
  assert.strictEqual(updated.openInterest, 0)
  assert.strictEqual(updated.fundingRate, 0)
  assert.strictEqual(updated.markPrice, 100)
  assert.strictEqual(updated.timestamp.μs, 456)
  assert.strictEqual(updated.localTimestamp, localTimestamp)
  assert.deepStrictEqual(map(premium), [])
})

test('WhiteBIT initializes last price from REST and gives accepted WebSocket trades precedence per market', () => {
  const localTimestamp = new Date('2026-10-26T12:22:00Z')
  const mapper = normalizeDerivativeTickers('whitebit', localTimestamp)
  const map = (message: any) => [...mapper.map(message, localTimestamp)!]
  const rest = (symbol: string, last_price: string, open_interest = '10') => ({
    method: 'futures_update',
    params: [symbol, { last_price, open_interest }]
  })
  const premium = (symbol = 'BTC_PERP') => ({
    method: 'premiumIndex_update',
    params: [symbol, '100', '101', '0.0001', 1793030400000, 1793017320.123456]
  })
  const trade = (id: number, price: string) => ({
    method: 'trades_update',
    params: ['BTC_PERP', [{ id, price, amount: '1', type: 'buy', time: 1793017320.123456 }]]
  })

  assert.deepStrictEqual(map({ method: 'trades_update', params: ['BTC_PERP', []] }), [])
  assert.deepStrictEqual(map(rest('BTC_PERP', '99')), [])
  const [initial] = map(premium())
  assert.strictEqual(initial.lastPrice, 99)
  assert.strictEqual(initial.openInterest, 10)
  assert.strictEqual(initial.localTimestamp, localTimestamp)
  assert.strictEqual(initial.timestamp.valueOf(), 1793017320123)
  assert.strictEqual(initial.timestamp.μs, 456)

  assert.deepStrictEqual(map(rest('BTC_PERP', '100')), [])
  assert.strictEqual(map(premium())[0].lastPrice, 100)
  assert.deepStrictEqual(map(trade(20, '102')), [])
  assert.deepStrictEqual(map(rest('BTC_PERP', '90', '11')), [])
  const [afterTrade] = map(premium())
  assert.strictEqual(afterTrade.lastPrice, 102)
  assert.strictEqual(afterTrade.openInterest, 11)
  assert.deepStrictEqual(map(rest('BTC_PERP', '80', '11')), [])
  assert.deepStrictEqual(map(premium()), [])
  assert.deepStrictEqual(map(trade(21, '103')), [])
  assert.strictEqual(map(premium())[0].lastPrice, 103)

  assert.deepStrictEqual(map(rest('ETH_PERP', '50')), [])
  assert.strictEqual(map(premium('ETH_PERP'))[0].lastPrice, 50)
  const freshMapper = normalizeDerivativeTickers('whitebit', localTimestamp)
  assert.deepStrictEqual([...freshMapper.map(rest('BTC_PERP', '95'), localTimestamp)!], [])
  assert.strictEqual([...freshMapper.map(premium(), localTimestamp)!][0].lastPrice, 95)
})

test('WhiteBIT derivative filters retain spot trades and cache the latest execution in either batch order', () => {
  const mapper = normalizeDerivativeTickers('whitebit', new Date())
  assert.deepStrictEqual(mapper.getFilters(['btc_usdt']), [{ channel: 'trades_update', symbols: ['BTC_USDT'] }])
  assert.deepStrictEqual(mapper.getFilters(['btc_usdt', 'btc_perp']), [
    { channel: 'trades_update', symbols: ['BTC_USDT', 'BTC_PERP'] },
    { channel: 'premiumIndex_update', symbols: ['BTC_PERP'] },
    { channel: 'futures_update', symbols: ['BTC_PERP'] }
  ])
  assert.deepStrictEqual(mapper.getFilters(), [
    { channel: 'trades_update', symbols: undefined },
    { channel: 'premiumIndex_update', symbols: [] },
    { channel: 'futures_update', symbols: [] }
  ])
  const localTimestamp = new Date()
  for (const ids of [
    [10, 11],
    [13, 12]
  ]) {
    const trades = ids.map((id) => ({ id, price: String(id), amount: '1', type: 'buy', time: 1793015160 }))
    assert.deepStrictEqual([...mapper.map({ method: 'trades_update', params: ['BTC_PERP', trades] }, localTimestamp)!], [])
    const [ticker] = mapper.map(
      { method: 'premiumIndex_update', params: ['BTC_PERP', '100', '101', '0', 1793030400000, 1793015160] },
      localTimestamp
    )!
    assert.strictEqual(ticker.lastPrice, Math.max(...ids))
  }
})

test('WhiteBIT spot-only derivative streaming stays responsive and emits no tickers', { timeout: 10000 }, async () => {
  const server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const originalURL = process.env.WSS_URL_WHITEBIT
  process.env.WSS_URL_WHITEBIT = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
  const subscriptions: unknown[] = []
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      subscriptions.push(JSON.parse(data.toString()))
      socket.send(JSON.stringify({ method: 'trades_update', params: ['BTC_USDT', [{ id: 1, price: '100' }]], id: null }))
    })
  })
  const errors: Error[] = []
  const iterator = streamNormalized(
    { exchange: 'whitebit', symbols: ['btc_usdt'], onError: (error) => errors.push(error) },
    normalizeDerivativeTickers
  )
  const tickers: unknown[] = []
  const consume = (async () => {
    for await (const ticker of iterator) tickers.push(ticker)
  })()
  try {
    while (subscriptions.length === 0) await sleep(10)
    await sleep(50)
    assert.deepStrictEqual(subscriptions, [{ id: 1, method: 'trades_subscribe', params: ['BTC_USDT'] }])
    assert.deepStrictEqual(tickers, [])
    assert.deepStrictEqual(errors, [])
  } finally {
    await iterator.return!()
    await consume
    if (originalURL === undefined) delete process.env.WSS_URL_WHITEBIT
    else process.env.WSS_URL_WHITEBIT = originalURL
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('WhiteBIT replay decodes numeric timestamps, rounds microseconds and preserves raw bytes', { timeout: 10000 }, async () => {
  const raw =
    '{"method":"trades_update","params":["BTC_PERP",[{"id":24449944864,"time":1793089243.4692869,"price":"100","amount":"1","type":"buy"}]],"id":null}'
  const slice = gzipSync(`2026-10-26T11:46:00.2237890Z ${raw}\n`)
  const requestedFilters: unknown[] = []
  const server = createServer((request, response) => {
    const filters = new URL(request.url!, 'http://localhost').searchParams.get('filters')
    requestedFilters.push(filters === null ? null : JSON.parse(filters))
    response.setHeader('content-type', 'application/octet-stream')
    response.setHeader('content-encoding', 'gzip')
    response.setHeader('x-slice-size', '1')
    response.end(slice)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'whitebit-replay-'))
  init({ endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, cacheDir, dataFeedCompression: 'gzip' })
  const options = { exchange: 'whitebit' as const, from: '2026-10-26T11:46:00Z', to: '2026-10-26T11:47:00Z' }
  try {
    const decoded = []
    for await (const message of replay({ ...options, filters: [{ channel: 'trades_update' }], withMicroseconds: true })) {
      decoded.push(message)
    }
    assert.strictEqual(decoded[0].message.params[1][0].id, 24449944864)
    assert.strictEqual(decoded[0].message.params[1][0].time, 1793089243.4692869)
    assert.strictEqual(decoded[0].localTimestamp.μs, 789)
    const bytes = []
    for await (const message of replay({ ...options, filters: [{ channel: 'trades_update' }], skipDecoding: true })) {
      bytes.push(message)
    }
    assert.strictEqual(bytes[0].message.toString(), raw)
    const normalized = []
    for await (const trade of replayNormalized({ ...options, symbols: ['BTC_PERP'] }, normalizeTrades)) {
      normalized.push(trade)
    }
    assert.strictEqual(normalized.length, 1)
    assert.strictEqual(normalized[0].id, '24449944864')
    assert.strictEqual(normalized[0].timestamp.valueOf(), 1793089243469)
    assert.strictEqual(normalized[0].timestamp.μs, 287)
    assert.strictEqual(normalized[0].localTimestamp.μs, 789)
    requestedFilters.length = 0
    const spotTickers = []
    for await (const ticker of replayNormalized({ ...options, symbols: ['btc_usdt'] }, normalizeDerivativeTickers)) {
      spotTickers.push(ticker)
    }
    assert.deepStrictEqual(spotTickers, [])
    assert.deepStrictEqual(requestedFilters, [[{ channel: 'trades_update', symbols: ['BTC_USDT'] }]])
  } finally {
    init()
    rmSync(cacheDir, { recursive: true, force: true })
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

for (const validateSequence of [undefined, true, false]) {
  test(`WhiteBIT depth continuity: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const depth = (snapshot: boolean, update_id: number, past_update_id?: number, symbol = 'BTC_USDT') => ({
      method: 'depth_update',
      params: [snapshot, { update_id, ...(past_update_id === undefined ? {} : { past_update_id }) }, symbol],
      id: null
    })
    const native = [
      { id: 1, result: { status: 'success' }, error: null },
      depth(false, 10, 9),
      depth(false, 12, 10),
      depth(false, 12, 10),
      depth(true, 100),
      depth(false, 105, 100),
      depth(true, 0),
      depth(false, 1, 0),
      depth(true, 500, undefined, 'ETH_USDT'),
      depth(false, 501, 500, 'ETH_USDT'),
      { method: 'bookTicker_update', params: [[0, 0, 'BTC_USDT', 999999]], id: null },
      depth(false, 2, 1)
    ]
    const gap = depth(false, 4, 3)
    const errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('whitebit')
    server.on('connection', (socket) =>
      socket.once('message', () => {
        for (const message of [...native, gap]) socket.send(JSON.stringify(message))
      })
    )
    const messages = stream({
      exchange: 'whitebit',
      filters: [{ channel: 'depth_update', symbols: ['BTC_USDT', 'ETH_USDT'] }],
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
        assert.strictEqual(errors[0].exchange, 'whitebit')
        assert.strictEqual(errors[0].key, 'BTC_USDT')
        assert.strictEqual(errors[0].expectedPreviousSequence, 2)
        assert.strictEqual(errors[0].previousSequence, 3)
        assert.strictEqual(errors[0].sequence, 4)
      }
    } finally {
      await messages.return?.()
      await cleanup()
    }
  })
}

for (const normalized of [false, true]) {
  for (const withDisconnects of [false, true]) {
    test(`WhiteBIT sequence recovery: normalized=${normalized}, disconnects=${withDisconnects}`, { timeout: 10000 }, async () => {
      const errors: Error[] = []
      const connections = new Map<string, number>()
      let sendGap: (() => void) | undefined
      const depth = (symbol: string, snapshot: boolean, update_id: number, past_update_id?: number) => ({
        method: 'depth_update',
        params: [snapshot, { timestamp: 1794300000, update_id, past_update_id, bids: [['100', String(update_id)]], asks: [] }, symbol],
        id: null
      })
      const { server, cleanup } = await createTestWebSocketServer('whitebit')
      server.on('connection', (socket) =>
        socket.once('message', (bytes) => {
          const { method, params } = JSON.parse(bytes.toString())
          assert.strictEqual(method, 'depth_subscribe')
          const symbol = params[0]
          const attempt = (connections.get(symbol) ?? 0) + 1
          connections.set(symbol, attempt)
          socket.send(JSON.stringify(depth(symbol, true, attempt === 1 ? 100 : 0)))
          socket.send(JSON.stringify(depth(symbol, false, attempt === 1 ? 105 : 2, attempt === 1 ? 100 : 0)))
          if (attempt === 1 && symbol === 'BTC_USDT') {
            sendGap = () => socket.send(JSON.stringify(depth(symbol, false, 110, 109)))
          }
        })
      )
      const symbols = ['BTC_USDT', 'BTC_PERP']
      const options = { exchange: 'whitebit' as const, timeoutIntervalMS: 0, onError: (error: Error) => errors.push(error) }
      const messages = normalized
        ? streamNormalized({ ...options, symbols, withDisconnectMessages: withDisconnects }, normalizeBookChanges)
        : stream({ ...options, filters: [{ channel: 'depth_update', symbols }], withDisconnects })
      const output = new Map<string, { snapshot: boolean; amount: number }[]>()
      let boundaries = 0
      try {
        for await (const message of messages) {
          if (message === undefined || ('type' in message && message.type === 'disconnect')) {
            boundaries++
            continue
          }
          const { symbol, snapshot, amount } =
            'message' in message
              ? { symbol: message.message.params[2], snapshot: message.message.params[0], amount: message.message.params[1].update_id }
              : { symbol: message.symbol, snapshot: message.isSnapshot, amount: message.bids[0].amount }
          const values = output.get(symbol) ?? []
          values.push({ snapshot, amount })
          output.set(symbol, values)
          if (symbols.every((symbol) => output.get(symbol)?.length === 2)) sendGap!()
          if (symbols.every((symbol) => output.get(symbol)?.at(-1)?.amount === 2)) break
        }
        for (const symbol of symbols) {
          assert.deepStrictEqual(output.get(symbol), [
            { snapshot: true, amount: 100 },
            { snapshot: false, amount: 105 },
            { snapshot: true, amount: 0 },
            { snapshot: false, amount: 2 }
          ])
          assert.strictEqual(connections.get(symbol), 2)
        }
        assert.strictEqual(boundaries, withDisconnects ? 1 : 0)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
      } finally {
        await messages.return?.()
        await cleanup()
      }
    })
  }
}

test('WhiteBIT normalized opt-out preserves snapshot resets and gaps', { timeout: 10000 }, async () => {
  const errors: Error[] = []
  const { server, cleanup } = await createTestWebSocketServer('whitebit')
  server.on('connection', (socket) =>
    socket.once('message', () => {
      for (const [snapshot, update_id, past_update_id] of [
        [true, 100],
        [false, 110, 109],
        [true, 0],
        [false, 2, 0]
      ]) {
        socket.send(
          JSON.stringify({
            method: 'depth_update',
            params: [snapshot, { timestamp: 1794300000, update_id, past_update_id, bids: [['100', String(update_id)]] }, 'BTC_PERP'],
            id: null
          })
        )
      }
    })
  )
  const messages = streamNormalized(
    { exchange: 'whitebit', symbols: ['BTC_PERP'], timeoutIntervalMS: 0, validateSequence: false, onError: (error) => errors.push(error) },
    normalizeBookChanges
  )
  try {
    for (const amount of [100, 110, 0, 2]) assert.deepStrictEqual((await messages.next()).value.bids, [{ price: 100, amount }])
    assert.deepStrictEqual(errors, [])
  } finally {
    await messages.return?.()
    await cleanup()
  }
})

for (const missing of ['update_id', 'past_update_id']) {
  test(`WhiteBIT rejects depth without ${missing}, matching recorder`, { timeout: 10000 }, async () => {
    const errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('whitebit')
    server.on('connection', (socket) =>
      socket.once('message', () => {
        socket.send(JSON.stringify({ method: 'depth_update', params: [true, { update_id: 100 }, 'BTC_USDT'] }))
        socket.send(
          JSON.stringify({
            method: 'depth_update',
            params: [
              false,
              { ...(missing === 'update_id' ? {} : { update_id: 101 }), ...(missing === 'past_update_id' ? {} : { past_update_id: 100 }) },
              'BTC_USDT'
            ]
          })
        )
      })
    )
    const messages = stream({
      exchange: 'whitebit',
      filters: [{ channel: 'depth_update', symbols: ['BTC_USDT'] }],
      timeoutIntervalMS: 0,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })
    try {
      assert.ok((await messages.next()).value)
      assert.strictEqual((await messages.next()).value, undefined)
      assert.strictEqual(errors.length, 1)
      assert.strictEqual(errors[0].message, 'WhiteBIT depth message is missing its sequence identifiers.')
    } finally {
      await messages.return?.()
      await cleanup()
    }
  })
}
