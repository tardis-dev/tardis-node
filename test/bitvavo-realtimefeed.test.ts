import { afterEach, beforeEach, mock, test } from 'node:test'
import type { Filter } from '../dist/types.js'
import { BitvavoRealTimeFeed } from '../dist/realtimefeeds/bitvavo.js'
import { normalizeBookChanges, normalizeTrades, SequenceGapError, stream, streamNormalized } from '../dist/index.js'
import { assert, errorMessageIncludes } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

class TestBitvavoRealTimeFeed extends BitvavoRealTimeFeed {
  readonly sentMessages: any[] = []

  constructor(filters: Filter<string>[]) {
    super('bitvavo', filters, undefined)
  }

  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }

  parse(message: string) {
    return this.parseMessage(Buffer.from(message))
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

test('preserves recorded Bitvavo nanoseconds before normalizing live messages', () => {
  const feed = new TestBitvavoRealTimeFeed([])
  const trade = feed.parse(
    '{"event":"trade","id":"00000000-0000-0431-0000-0000037d31c0","amount":"0.01158052","price":"75278","timestamp":1790121608063,"market":"BTC-EUR","side":"sell","timestampNs":1790121608063273941}'
  )
  assert.strictEqual(trade.timestamp, 1790121608063)
  assert.strictEqual(trade.timestampNs, '1790121608063273941')
  const [normalized] = normalizeTrades('bitvavo', new Date()).map(trade, new Date())!
  assert.strictEqual(normalized.timestamp.toISOString(), '2026-09-23T00:00:08.063Z')
  assert.strictEqual(normalized.timestamp.μs, 273)

  const book = feed.parse(
    '{"event":"book","market":"BTC-EUR","nonce":4252050802,"bids":[],"asks":[["75450.00","0.20300000"]],"timestamp":1790121600180154287,"startMdSeqNo":4252050802,"endMdSeqNo":4252050802,"type":"update"}'
  )
  assert.strictEqual(book.timestamp, '1790121600180154287')
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

for (const validateSequence of [undefined, false]) {
  test(`Bitvavo: sequence validation ${validateSequence === false ? 'disabled' : 'default'}`, { timeout: 10000 }, async () => {
    const book = (startMdSeqNo: number, endMdSeqNo: number) => ({
      event: 'book',
      market: 'BTC-EUR',
      nonce: 9999,
      startMdSeqNo,
      endMdSeqNo,
      bids: [['100', '1']],
      asks: [],
      timestamp: '1793786400000000000',
      type: 'update'
    })
    const snapshot = (mdSeqNo: number, requestId = 1) => ({
      action: 'getBook',
      requestId,
      response: { market: 'BTC-EUR', nonce: 9999, mdSeqNo, bids: [['100', '1']], asks: [], timestamp: '1793786400000000000' }
    })
    const valid = [book(101, 102), book(103, 105), snapshot(102), book(106, 106)]
    const recovered = [book(1, 3), snapshot(1, 2), book(4, 4)]
    const gap = book(108, 109)
    const errors: Error[] = []
    let connectionCount = 0
    const { server, cleanup } = await createTestWebSocketServer('bitvavo')
    server.on('connection', (socket) => {
      const initial = connectionCount++ === 0
      socket.on('message', (bytes) => {
        const request = JSON.parse(bytes.toString())
        if (request.action === 'authenticate') {
          socket.send(JSON.stringify({ event: 'authenticate', authenticated: true }))
        } else if (request.action === 'subscribe') {
          for (const message of initial ? valid.slice(0, 2) : recovered.slice(0, 1)) socket.send(JSON.stringify(message))
        } else if (request.action === 'getBook') {
          for (const message of initial ? [...valid.slice(2), gap] : recovered.slice(1)) socket.send(JSON.stringify(message))
        }
      })
    })
    const messages = stream({
      exchange: 'bitvavo',
      filters: [
        { channel: 'book', symbols: ['BTC-EUR'] },
        { channel: 'getBook', symbols: ['BTC-EUR'] }
      ],
      timeoutIntervalMS: 0,
      validateSequence,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })

    try {
      assert.strictEqual((await messages.next()).value?.message.event, 'authenticate')
      for (const message of valid) assert.deepStrictEqual((await messages.next()).value?.message, message)
      const next = (await messages.next()).value
      if (validateSequence === false) {
        assert.deepStrictEqual(next?.message, gap)
        assert.deepStrictEqual(errors, [])
      } else {
        assert.strictEqual(next, undefined)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
        assert.strictEqual(errors[0].key, 'BTC-EUR')
        assert.strictEqual(errors[0].expectedPreviousSequence, 106)
        assert.strictEqual(errors[0].previousSequence, 107)
        assert.strictEqual(errors[0].sequence, 109)
        assert.strictEqual((await messages.next()).value?.message.event, 'authenticate')
        for (const message of recovered) assert.deepStrictEqual((await messages.next()).value?.message, message)
        assert.strictEqual(errors.length, 1)
        assert.strictEqual(connectionCount, 2)
      }
    } finally {
      try {
        await messages.return?.()
      } finally {
        await cleanup()
      }
    }
  })
}

for (const firstSequence of [101, 102]) {
  test(
    `Bitvavo normalized opt-out ${firstSequence === 101 ? 'permits continuous gaps' : 'retains snapshot overlap validation'}`,
    { timeout: 10000 },
    async () => {
      const errors: Error[] = []
      const { server, cleanup } = await createTestWebSocketServer('bitvavo')
      server.on('connection', (socket) => {
        socket.on('message', (bytes) => {
          const request = JSON.parse(bytes.toString())
          if (request.action === 'authenticate') {
            socket.send(JSON.stringify({ event: 'authenticate', authenticated: true }))
          } else if (request.action === 'subscribe') {
            socket.send(
              JSON.stringify({
                event: 'book',
                market: 'BTC-EUR',
                nonce: firstSequence,
                startMdSeqNo: firstSequence,
                endMdSeqNo: firstSequence,
                bids: [],
                asks: [],
                timestamp: '1793786400000000000'
              })
            )
          } else if (request.action === 'getBook') {
            socket.send(
              JSON.stringify({
                action: 'getBook',
                requestId: request.requestId,
                response: { market: 'BTC-EUR', nonce: 100, mdSeqNo: 100, bids: [], asks: [], timestamp: '1793786400000000000' }
              })
            )
            socket.send(
              JSON.stringify({
                event: 'book',
                market: 'BTC-EUR',
                nonce: 103,
                startMdSeqNo: 103,
                endMdSeqNo: 103,
                bids: [['100', '3']],
                asks: [],
                timestamp: '1793786400000000000'
              })
            )
          }
        })
      })
      const messages = streamNormalized(
        {
          exchange: 'bitvavo',
          symbols: ['BTC-EUR'],
          timeoutIntervalMS: 0,
          validateSequence: false,
          withDisconnectMessages: true,
          onError: (error) => errors.push(error)
        },
        normalizeBookChanges
      )
      try {
        assert.strictEqual((await messages.next()).value.type, 'book_change')
        if (firstSequence === 101) {
          assert.strictEqual((await messages.next()).value.type, 'book_change')
          const update = (await messages.next()).value
          assert.strictEqual(update.type, 'book_change')
          assert.deepStrictEqual(update.bids, [{ price: 100, amount: 3 }])
          assert.deepStrictEqual(errors, [])
        } else {
          assert.strictEqual((await messages.next()).value.type, 'disconnect')
          assert.strictEqual(errors.length, 1)
          assert.match(errors[0].message, /snapshot has no overlap/)
          assert.ok(!(errors[0] instanceof SequenceGapError))
        }
      } finally {
        try {
          await messages.return?.()
        } finally {
          await cleanup()
        }
      }
    }
  )
}

for (const missingField of ['startMdSeqNo', 'endMdSeqNo', 'mdSeqNo'] as const) {
  test(`Bitvavo rejects nonce fallback when ${missingField} is missing`, { timeout: 10000 }, async () => {
    const snapshot = {
      action: 'getBook',
      requestId: 1,
      response: {
        market: 'BTC-EUR',
        nonce: 10,
        bids: [],
        asks: [],
        timestamp: '1793786400000000000',
        ...(missingField === 'mdSeqNo' ? {} : { mdSeqNo: 10 })
      }
    }
    const update = {
      event: 'book',
      market: 'BTC-EUR',
      nonce: 11,
      bids: [],
      asks: [],
      timestamp: '1793786400000000000',
      ...(missingField === 'startMdSeqNo' ? {} : { startMdSeqNo: 11 }),
      ...(missingField === 'endMdSeqNo' ? {} : { endMdSeqNo: 11 })
    }
    const errors: Error[] = []
    const isSnapshot = missingField === 'mdSeqNo'
    const { server, cleanup } = await createTestWebSocketServer('bitvavo')
    server.on('connection', (socket) => {
      socket.on('message', (bytes) => {
        const request = JSON.parse(bytes.toString())
        if (request.action === 'authenticate') {
          socket.send(JSON.stringify({ event: 'authenticate', authenticated: true }))
        } else if (request.action === (isSnapshot ? 'getBook' : 'subscribe')) {
          socket.send(JSON.stringify(isSnapshot ? snapshot : update))
        }
      })
    })
    const messages = stream({
      exchange: 'bitvavo',
      filters: [{ channel: isSnapshot ? 'getBook' : 'book', symbols: ['BTC-EUR'] }],
      timeoutIntervalMS: 0,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })
    try {
      assert.strictEqual((await messages.next()).value?.message.event, 'authenticate')
      assert.strictEqual((await messages.next()).value, undefined)
      assert.strictEqual(errors.length, 1)
      assert.match(errors[0].message, /missing or invalid/)

      const mapper = normalizeBookChanges('bitvavo', new Date('2026-10-01T00:00:00Z'))
      if (!isSnapshot) [...mapper.map(snapshot, new Date())!]
      assert.throws(() => [...mapper.map(isSnapshot ? snapshot : update, new Date())!], /missing or invalid/)
    } finally {
      try {
        await messages.return?.()
      } finally {
        await cleanup()
      }
    }
  })
}

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
