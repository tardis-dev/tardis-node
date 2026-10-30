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
import {
  init,
  normalizeTrades,
  normalizeBookChanges,
  normalizeBookTickers,
  normalizeDerivativeTickers,
  replay,
  replayNormalized,
  stream
} from '../dist/index.js'
import type { Filter } from '../dist/types.js'
import { WhiteBitRealTimeFeed, WhiteBitWebSocketRealTimeFeed } from '../dist/realtimefeeds/whitebit.js'

class TestWhiteBitWebSocketFeed extends WhiteBitWebSocketRealTimeFeed {
  observe(message: any) {
    this.onMessage(message)
  }
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

test('WhiteBIT preserves the full trade timestamp and truncates normalized microseconds', () => {
  const feed = new TestWhiteBitWebSocketFeed('whitebit', [], undefined)
  const message = feed.parse(
    '{"method":"trades_update","params":["BTC_PERP",[{"id":24449944864,"time":1793089243.4692869,"price":"100","amount":"1","type":"buy"}]],"id":null}'
  )
  const [trade] = normalizeTrades('whitebit', new Date()).map(message, new Date())!
  assert.strictEqual(message.params[1][0].id, 24449944864)
  assert.strictEqual(message.params[1][0].time, '1793089243.4692869')
  assert.strictEqual(trade.id, '24449944864')
  assert.strictEqual(trade.timestamp.valueOf(), 1793089243469)
  assert.strictEqual(trade.timestamp.μs, 286)
})

test('WhiteBIT preserves depth, BBO and premium-index timestamps without changing counters or funding milliseconds', () => {
  const feed = new TestWhiteBitWebSocketFeed('whitebit', [], undefined)
  const localTimestamp = new Date()
  const depth = feed.parse(
    '{"params":[true,{"timestamp":1793015153.5139771,"event_time":1793015159.1234569,"update_id":25167412357,"bids":[],"asks":[]},"BTC_PERP"],"method":"depth_update","id":null}'
  )
  assert.strictEqual(depth.params[1].timestamp, '1793015153.5139771')
  assert.strictEqual(depth.params[1].event_time, '1793015159.1234569')
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
      ['1793089243.4692869', '1793089243.4692879', 'BTC_PERP', 25167412357],
      [1793089244, '1793089244.1', 'XAU_PERP', 25167412358]
    ]
  )
  const tickers = [...normalizeBookTickers('whitebit', localTimestamp).map(bbo, localTimestamp)!]
  assert.strictEqual(tickers[0].timestamp.μs, 286)
  assert.strictEqual(tickers[1].timestamp.valueOf(), 1793089244000)
  assert.strictEqual(tickers[1].timestamp.μs, 0)

  const premium = feed.parse(
    '{"id":null,"params":["BTC_PERP","100","101","0.0001",1793097600000,1793089243.4692869],"method":"premiumIndex_update"}'
  )
  assert.strictEqual(premium.params[4], 1793097600000)
  assert.strictEqual(premium.params[5], '1793089243.4692869')
  const [ticker] = normalizeDerivativeTickers('whitebit', localTimestamp).map(premium, localTimestamp)!
  assert.strictEqual(ticker.timestamp.valueOf(), 1793089243469)
  assert.strictEqual(ticker.timestamp.μs, 286)
  assert.strictEqual(ticker.fundingTimestamp!.valueOf(), 1793097600000)
  assert.strictEqual(ticker.localTimestamp, localTimestamp)
  assert.deepStrictEqual(
    feed.parse('{"id":1,"result":{"message":"Example: 1793089243.4692869, keep \\"quoted\\" text","price":"100.1234567"}}'),
    { id: 1, result: { message: 'Example: 1793089243.4692869, keep "quoted" text', price: '100.1234567' } }
  )
})

test('WhiteBIT live depth detects gaps and accepts snapshot resets', () => {
  const feed = new TestWhiteBitWebSocketFeed('whitebit', [], undefined)
  const depth = (isSnapshot: boolean, update_id: number, past_update_id?: number) => ({
    method: 'depth_update',
    params: [isSnapshot, { update_id, past_update_id }, 'BTC_PERP']
  })
  feed.observe(depth(true, 10))
  feed.observe(depth(false, 12, 10))
  feed.observe(depth(true, 20))
  feed.observe(depth(false, 21, 20))
  assert.throws(() => feed.observe(depth(false, 23, 22)), /WhiteBIT depth sequence gap for BTC_PERP/)
  feed.map([{ channel: 'depth_update', symbols: ['BTC_PERP'] }])
  assert.throws(() => feed.observe(depth(false, 22, 21)), /WhiteBIT depth sequence gap for BTC_PERP/)
  feed.observe(depth(true, 30))
  feed.observe(depth(false, 31, 30))
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
  const premium = { method: 'premiumIndex_update', params: ['BTC_PERP', '100', '101', '0.01', 1793030400000, '1793015160.123456'] }
  assert.strictEqual(map(premium)[0].openInterest, 10)
  assert.deepStrictEqual(map({ method: 'futures_update', params: ['BTC_PERP', { open_interest: '0', mark_price: '1' }] }), [])
  premium.params = ['BTC_PERP', '100', '101', '0', 1793030400000, '1793015160.623456']
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
    params: [symbol, '100', '101', '0.0001', 1793030400000, '1793017320.123456']
  })
  const trade = (id: number, price: string) => ({
    method: 'trades_update',
    params: ['BTC_PERP', [{ id, price, amount: '1', type: 'buy', time: '1793017320.123456' }]]
  })

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

test('WhiteBIT rejects stale premium values without flushing pending updates, including within one millisecond', () => {
  for (const staleTime of ['1793015161.123900', '1793015162.123100']) {
    const mapper = normalizeDerivativeTickers('whitebit', new Date())
    const localTimestamp = new Date('2026-10-26T11:46:03Z')
    const map = (message: any) => [...mapper.map(message, localTimestamp)!]
    const premium = (time: string) => ({
      method: 'premiumIndex_update',
      params: ['BTC_PERP', '100', '101', '0.0001', 1793030400000, time]
    })
    const [initial] = map(premium('1793015160.123900'))
    assert.strictEqual(initial.markPrice, 100)
    // A snapshot with unchanged values must still advance the accepted source timestamp.
    assert.deepStrictEqual(map(premium('1793015162.123900')), [])
    assert.deepStrictEqual(map({ method: 'futures_update', params: ['BTC_PERP', { open_interest: '10' }] }), [])
    assert.deepStrictEqual(map({ method: 'trades_update', params: ['BTC_PERP', [{ id: 20, price: '102' }]] }), [])
    assert.deepStrictEqual(map({ method: 'premiumIndex_update', params: ['BTC_PERP', '90', '91', '-0.01', 1793034000000, staleTime] }), [])
    // Equal timestamps remain eligible to publish changes from REST and trades.
    const [updated] = map(premium('1793015162.123900'))
    assert.strictEqual(updated.markPrice, 100)
    assert.strictEqual(updated.indexPrice, 101)
    assert.strictEqual(updated.fundingRate, 0.0001)
    assert.strictEqual(updated.fundingTimestamp?.valueOf(), 1793030400000)
    assert.strictEqual(updated.openInterest, 10)
    assert.strictEqual(updated.lastPrice, 102)
    assert.strictEqual(updated.timestamp.valueOf(), 1793015162123)
    assert.strictEqual(updated.timestamp.μs, 900)
    assert.strictEqual(updated.localTimestamp, localTimestamp)
  }
})

test('WhiteBIT premium timestamp ordering is isolated per market and mapper instance', () => {
  const localTimestamp = new Date()
  const premium = (symbol: string, time: string) => ({
    method: 'premiumIndex_update',
    params: [symbol, '100', '101', '0', 1793030400000, time]
  })
  const mapper = normalizeDerivativeTickers('whitebit', localTimestamp)
  assert.strictEqual([...mapper.map(premium('BTC_PERP', '1793015162.123900'), localTimestamp)!].length, 1)
  const [otherMarket] = mapper.map(premium('ETH_PERP', '1793015160.123900'), localTimestamp)!
  assert.strictEqual(otherMarket.symbol, 'ETH_PERP')
  const freshMapper = normalizeDerivativeTickers('whitebit', localTimestamp)
  assert.strictEqual([...freshMapper.map(premium('BTC_PERP', '1793015160.123900'), localTimestamp)!].length, 1)
})

test('WhiteBIT derivative filters exclude spot markets and cache the latest execution in either batch order', () => {
  const mapper = normalizeDerivativeTickers('whitebit', new Date())
  assert.deepStrictEqual(mapper.getFilters(['BTC_USDT']), [])
  assert.ok(mapper.getFilters(['BTC_USDT', 'BTC_PERP']).every(({ symbols }) => symbols?.join() === 'BTC_PERP'))
  const localTimestamp = new Date()
  for (const ids of [
    [10, 11],
    [13, 12]
  ]) {
    const trades = ids.map((id) => ({ id, price: String(id), amount: '1', type: 'buy', time: '1793015160' }))
    assert.deepStrictEqual([...mapper.map({ method: 'trades_update', params: ['BTC_PERP', trades] }, localTimestamp)!], [])
    const [ticker] = mapper.map(
      { method: 'premiumIndex_update', params: ['BTC_PERP', '100', '101', '0', 1793030400000, '1793015160'] },
      localTimestamp
    )!
    assert.strictEqual(ticker.lastPrice, Math.max(...ids))
  }
})

test('WhiteBIT derivative last price rejects older and duplicate trade batches per market', () => {
  const localTimestamp = new Date()
  const mapper = normalizeDerivativeTickers('whitebit', localTimestamp)
  const map = (message: any) => [...mapper.map(message, localTimestamp)!]
  const trades = (symbol: string, values: [number, string][]) => ({
    method: 'trades_update',
    params: [symbol, values.map(([id, price]) => ({ id, price, amount: '1', type: 'buy', time: '1793015160' }))]
  })
  const premium = (symbol = 'BTC_PERP') => ({
    method: 'premiumIndex_update',
    params: [symbol, '100', '101', '0', 1793030400000, '1793015160.123900']
  })
  assert.deepStrictEqual(map(trades('BTC_PERP', [[20, '100']])), [])
  assert.strictEqual(map(premium())[0].lastPrice, 100)
  for (const batch of [
    [
      [19, '90'],
      [18, '89']
    ],
    [[20, '90']],
    [[22, '100']],
    [[21, '90']]
  ] as [number, string][][]) {
    assert.deepStrictEqual(map(trades('BTC_PERP', batch)), [])
    assert.deepStrictEqual(map(premium()), [])
  }
  assert.deepStrictEqual(
    map(
      trades('BTC_PERP', [
        [21, '90'],
        [23, '103']
      ])
    ),
    []
  )
  // An older batch arriving before the next premium tick must not replace the pending price either.
  assert.deepStrictEqual(map(trades('BTC_PERP', [[20, '80']])), [])
  assert.strictEqual(map(premium())[0].lastPrice, 103)
  assert.deepStrictEqual(
    map(
      trades('BTC_PERP', [
        [25, '105'],
        [24, '104']
      ])
    ),
    []
  )
  assert.strictEqual(map(premium())[0].lastPrice, 105)
  assert.deepStrictEqual(map(trades('BTC_PERP', [])), [])
  assert.deepStrictEqual(map(premium()), [])

  assert.deepStrictEqual(map(trades('ETH_PERP', [[1, '50']])), [])
  assert.strictEqual(map(premium('ETH_PERP'))[0].lastPrice, 50)
  const freshMapper = normalizeDerivativeTickers('whitebit', localTimestamp)
  assert.deepStrictEqual([...freshMapper.map(trades('BTC_PERP', [[1, '40']]), localTimestamp)!], [])
  const [fresh] = freshMapper.map(premium(), localTimestamp)!
  assert.strictEqual(fresh.lastPrice, 40)
})

test('WhiteBIT replay preserves complete native timestamps and truncates only during normalization', { timeout: 10000 }, async () => {
  const raw =
    '{"method":"trades_update","params":["BTC_PERP",[{"id":24449944864,"time":1793089243.4692869,"price":"100","amount":"1","type":"buy"}]],"id":null}'
  const slice = gzipSync(`2026-10-26T11:46:00.2237890Z ${raw}\n`)
  const server = createServer((_, response) => {
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
    assert.strictEqual(decoded[0].message.params[1][0].time, '1793089243.4692869')
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
    assert.strictEqual(normalized[0].timestamp.μs, 286)
    assert.strictEqual(normalized[0].localTimestamp.μs, 789)
  } finally {
    init()
    rmSync(cacheDir, { recursive: true, force: true })
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
