import { afterEach, beforeEach, mock, test } from 'node:test'
import type { Filter } from '../dist/types.js'
import { BitvavoRealTimeFeed } from '../dist/realtimefeeds/bitvavo.js'
import { assert, errorMessageIncludes } from './assertions.ts'

class TestBitvavoRealTimeFeed extends BitvavoRealTimeFeed {
  readonly sentMessages: any[] = []

  constructor(filters: Filter<string>[]) {
    super('bitvavo', filters, undefined)
  }

  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }

  endpoint() {
    return this.wssURL
  }

  connect() {
    return this.onConnected()
  }

  observe(message: any) {
    this.onMessage(message)
  }

  protected send(message: any) {
    this.sentMessages.push(message)
  }
}

const originalApiKey = process.env.BITVAVO_API_KEY
const originalApiSecret = process.env.BITVAVO_API_SECRET

beforeEach(() => {
  process.env.BITVAVO_API_KEY = 'key'
  process.env.BITVAVO_API_SECRET = 'bitvavo'
})

afterEach(() => {
  mock.restoreAll()
  restoreEnvironmentVariable('BITVAVO_API_KEY', originalApiKey)
  restoreEnvironmentVariable('BITVAVO_API_SECRET', originalApiSecret)
})

test('authenticates Bitvavo Market Data Pro before subscribing', async () => {
  mock.method(Date, 'now', () => 1548175200641)
  const feed = new TestBitvavoRealTimeFeed([])
  const connected = feed.connect()

  assert.deepStrictEqual(feed.sentMessages, [
    {
      action: 'authenticate',
      key: 'key',
      signature: '653fc0505431c63a043273da4bd2f0927eae83948d796084f313e5d1131b0d6f',
      timestamp: 1548175200641
    }
  ])

  feed.observe({ event: 'authenticate', authenticated: true })
  await connected
})

test('uses the Bitvavo Market Data Pro endpoint', () => {
  const feed = new TestBitvavoRealTimeFeed([])
  assert.strictEqual(feed.endpoint(), 'wss://ws-mdpro.bitvavo.com/v2/')
})

test('rejects failed Bitvavo Market Data Pro authentication', async () => {
  const feed = new TestBitvavoRealTimeFeed([])
  const connected = feed.connect()
  feed.observe({ event: 'authenticate', authenticated: false })
  await assert.rejects(connected, errorMessageIncludes('authentication failed'))
})

test('requires Bitvavo Market Data Pro credentials', () => {
  delete process.env.BITVAVO_API_KEY
  delete process.env.BITVAVO_API_SECRET
  const feed = new TestBitvavoRealTimeFeed([])
  assert.throws(() => feed.map([{ channel: 'trade', symbols: ['BTC-EUR'] }]), errorMessageIncludes('BITVAVO_API_KEY'))
})

test('maps Bitvavo channels to one Market Data Pro WebSocket subscription', () => {
  const feed = new TestBitvavoRealTimeFeed([])

  assert.deepStrictEqual(
    feed.map([
      { channel: 'trade', symbols: ['BTC-EUR'] },
      { channel: 'book', symbols: ['BTC-EUR'] },
      { channel: 'getBook', symbols: ['BTC-EUR'] },
      { channel: 'ticker', symbols: ['ETH-EUR'] }
    ]),
    [
      {
        action: 'subscribe',
        channels: [
          { name: 'trades', markets: ['BTC-EUR'] },
          { name: 'book', markets: ['BTC-EUR'] },
          { name: 'ticker', markets: ['ETH-EUR'] }
        ]
      },
      {
        action: 'getBook',
        requestId: 1,
        market: 'BTC-EUR',
        depth: 1000
      }
    ]
  )
})

test('requires explicit symbols for Bitvavo live subscriptions', () => {
  const feed = new TestBitvavoRealTimeFeed([])
  assert.throws(() => feed.map([{ channel: 'trade' }]), errorMessageIncludes('requires explicitly specified symbols'))
})

test('requests Bitvavo book snapshots over the WebSocket connection', () => {
  const feed = new TestBitvavoRealTimeFeed([])
  assert.deepStrictEqual(feed.map([{ channel: 'getBook', symbols: ['BTC-EUR', 'ETH-EUR'] }]), [
    { action: 'getBook', requestId: 1, market: 'BTC-EUR', depth: 1000 },
    { action: 'getBook', requestId: 2, market: 'ETH-EUR', depth: 1000 }
  ])
})

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
