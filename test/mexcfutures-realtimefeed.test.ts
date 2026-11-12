import { test } from 'node:test'
import type { AddressInfo } from 'net'
import { assert } from './assertions.ts'
import { createServer } from 'http'
import type { Filter } from '../dist/types.js'
import { MexcFuturesRealTimeFeed } from '../dist/realtimefeeds/mexcfutures.js'
import { stream, streamNormalized, normalizeBookChanges, SequenceGapError } from '../dist/index.js'
import { createTestWebSocketServer } from './helpers/websocket.ts'

class TestMexcFuturesRealTimeFeed extends MexcFuturesRealTimeFeed {
  protected readonly httpURL: string

  constructor(
    exchange: 'mexc-futures',
    filters: Filter<string>[],
    timeoutIntervalMS: number | undefined,
    httpURL = 'https://contract.mexc.com'
  ) {
    super(exchange, filters, timeoutIntervalMS)
    this.httpURL = httpURL
  }

  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }

  observe(message: any) {
    this.onMessage(message)
  }

  async provideSnapshots(filters: Filter<string>[], shouldCancel = () => false) {
    await this.provideManualSnapshots(filters, shouldCancel)
    return this.manualSnapshotsBuffer
  }
}

test('aligns MEXC Futures updates that omit begin and end with a REST snapshot', async () => {
  const server = await startSnapshotServer()
  const feed = new TestMexcFuturesRealTimeFeed('mexc-futures', [], undefined, server.url)

  try {
    const filters = [
      {
        channel: 'push.depth',
        symbols: ['btc_usdt']
      },
      {
        channel: 'push.depth.snapshot',
        symbols: ['btc_usdt']
      }
    ]

    feed.map(filters)
    feed.observe({
      symbol: 'BTC_USDT',
      data: {
        asks: [],
        bids: [[75228, 32, 4]],
        cts: 1779703618130,
        version: 1
      },
      channel: 'push.depth',
      ts: 1779703618133
    })

    const snapshots = await feed.provideSnapshots(filters)

    assert.deepStrictEqual(snapshots, [
      {
        symbol: 'BTC_USDT',
        generated: true,
        channel: 'push.depth.snapshot',
        data: {
          cts: null,
          asks: [[75230, 1, 1]],
          bids: [[75220, 2, 2]],
          timestamp: 1782245602481,
          version: 0
        }
      }
    ])
  } finally {
    await server.close()
  }
})

test('retries MEXC Futures depth snapshots until the REST snapshot overlaps buffered WebSocket updates', async () => {
  const server = await startSnapshotServer([
    { success: true, code: 0, data: { cts: null, asks: [[75230, 1, 1]], bids: [[75220, 2, 2]], timestamp: 1782245602480, version: 102 } },
    { success: true, code: 0, data: { cts: null, asks: [[75233, 1, 1]], bids: [[75217, 2, 2]], timestamp: 1782245602481, version: 104 } }
  ])
  const feed = new TestMexcFuturesRealTimeFeed('mexc-futures', [], undefined, server.url)

  try {
    const filters = [
      {
        channel: 'push.depth',
        symbols: ['BTC_USDT']
      },
      {
        channel: 'push.depth.snapshot',
        symbols: ['BTC_USDT']
      }
    ]

    feed.map(filters)
    feed.observe({
      symbol: 'BTC_USDT',
      data: {
        asks: [],
        bids: [[75228, 32, 4]],
        begin: 105,
        cts: 1779703618130,
        end: 105,
        version: 105
      },
      channel: 'push.depth',
      ts: 1779703618133
    })

    const snapshots = await feed.provideSnapshots(filters)

    assert.strictEqual(server.requestsCount, 2)
    assert.deepStrictEqual(snapshots, [
      {
        symbol: 'BTC_USDT',
        generated: true,
        channel: 'push.depth.snapshot',
        data: {
          cts: null,
          asks: [[75233, 1, 1]],
          bids: [[75217, 2, 2]],
          timestamp: 1782245602481,
          version: 104
        }
      }
    ])
  } finally {
    await server.close()
  }
})

async function startSnapshotServer(
  responses: MexcFuturesTestDepthSnapshotResponse[] = [
    { success: true, code: 0, data: { cts: null, asks: [[75230, 1, 1]], bids: [[75220, 2, 2]], timestamp: 1782245602481, version: 0 } }
  ]
) {
  let requestsCount = 0
  const server = createServer((request, response) => {
    assert.strictEqual(request.url, '/api/v1/contract/depth/BTC_USDT?limit=5000')
    const body = responses[Math.min(requestsCount, responses.length - 1)]
    requestsCount++

    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  })

  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    get requestsCount() {
      return requestsCount
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

type MexcFuturesTestDepthSnapshotResponse = {
  success: boolean
  code: number
  data: {
    cts: number | null
    asks: number[][]
    bids: number[][]
    timestamp: number
    version: number
  }
}

function futuresDepth(version: number, begin?: number | null, end?: number | null, symbol = 'BTC_USDT', empty = false) {
  return {
    channel: 'push.depth',
    symbol,
    ts: 1794300000000,
    data: { version, begin, end, bids: empty ? [] : [[100, version, 1]], asks: [] }
  }
}
function futuresSnapshot(version: number) {
  return {
    channel: 'push.depth.snapshot',
    symbol: 'BTC_USDT',
    generated: true,
    data: { version, timestamp: 1794300000000, bids: [[100, version, 1]], asks: [] }
  }
}
async function createFuturesSequenceServer() {
  const local = await createTestWebSocketServer()
  // This feed has a fixed /edge URL override; isolate only the transport endpoint in these public-API tests.
  const descriptor = Object.getOwnPropertyDescriptor(MexcFuturesRealTimeFeed.prototype, 'getWebSocketUrl')!
  Object.defineProperty(MexcFuturesRealTimeFeed.prototype, 'getWebSocketUrl', { ...descriptor, value: async () => local.wssURL })
  return {
    server: local.server,
    async cleanup() {
      Object.defineProperty(MexcFuturesRealTimeFeed.prototype, 'getWebSocketUrl', descriptor)
      await local.cleanup()
    }
  }
}

for (const validateSequence of [undefined, true, false]) {
  test(`MEXC Futures depth continuity: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const valid = [
      { channel: 'rs.sub.depth', data: 'success' },
      { channel: 'pong', data: 1794300000000 },
      futuresDepth(105, 100, 105),
      futuresDepth(110, 106, 110),
      futuresDepth(110, 106, 110),
      futuresDepth(115, 111, 115, 'BTC_USDT', true),
      futuresDepth(116, 0, 0),
      futuresDepth(117, null, null),
      futuresDepth(120, 118),
      futuresDepth(121, undefined, 122),
      futuresDepth(999, 500, 505, 'ETH_USDT'),
      futuresSnapshot(50),
      { channel: 'push.ticker', symbol: 'BTC_USDT', data: { version: 999999 } },
      futuresDepth(506, 0, 0, 'ETH_USDT')
    ].map((message) => JSON.parse(JSON.stringify(message)))
    const gap = futuresDepth(125, 124, 125),
      errors: Error[] = []
    const { server, cleanup } = await createFuturesSequenceServer()
    server.on('connection', (socket) =>
      socket.once('message', (bytes) => {
        assert.deepStrictEqual(JSON.parse(bytes.toString()), { method: 'sub.depth', param: { symbol: 'BTC_USDT' }, gzip: false })
        for (const message of [...valid, gap]) socket.send(JSON.stringify(message))
      })
    )
    const feed = stream({
      exchange: 'mexc-futures',
      filters: [{ channel: 'push.depth', symbols: ['BTC_USDT', 'ETH_USDT'] }],
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
        assert.strictEqual(errors[0].exchange, 'mexc-futures')
        assert.strictEqual(errors[0].key, 'BTC_USDT')
        assert.strictEqual(errors[0].expectedPreviousSequence, 122)
        assert.strictEqual(errors[0].previousSequence, 123)
        assert.strictEqual(errors[0].sequence, 125)
      }
    } finally {
      await feed.return?.()
      await cleanup()
    }
  })
}

for (const normalized of [false, true])
  for (const withDisconnects of [false, true]) {
    test(`MEXC Futures sequence recovery: normalized=${normalized}, disconnects=${withDisconnects}`, { timeout: 10000 }, async () => {
      let connections = 0
      const errors: Error[] = [],
        initial = [futuresSnapshot(100), futuresDepth(105, 101, 105), futuresDepth(110, 107, 110)],
        recovered = [futuresSnapshot(0), futuresDepth(2, 1, 2)]
      const { server, cleanup } = await createFuturesSequenceServer()
      server.on('connection', (socket) => {
        const first = ++connections === 1
        socket.once('message', () => {
          for (const message of first ? initial : recovered) socket.send(JSON.stringify(message))
        })
      })
      const options = { exchange: 'mexc-futures' as const, timeoutIntervalMS: 0, onError: (error: Error) => errors.push(error) }
      const feed = normalized
        ? streamNormalized({ ...options, symbols: ['BTC_USDT'], withDisconnectMessages: withDisconnects }, normalizeBookChanges)
        : stream({ ...options, filters: [{ channel: 'push.depth', symbols: ['BTC_USDT'] }], withDisconnects })
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

test('MEXC Futures normalized opt-out preserves snapshot mapping across a gap', { timeout: 10000 }, async () => {
  const errors: Error[] = [],
    { server, cleanup } = await createFuturesSequenceServer()
  server.on('connection', (socket) =>
    socket.once('message', () => {
      for (const message of [futuresSnapshot(100), futuresDepth(105, 101, 105), futuresDepth(110, 107, 110)])
        socket.send(JSON.stringify(message))
    })
  )
  const feed = streamNormalized(
    {
      exchange: 'mexc-futures',
      symbols: ['BTC_USDT'],
      timeoutIntervalMS: 0,
      validateSequence: false,
      onError: (error) => errors.push(error)
    },
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

test('MEXC Futures normalized opt-out retains initial snapshot overlap validation', { timeout: 10000 }, async () => {
  const errors: Error[] = [],
    { server, cleanup } = await createFuturesSequenceServer()
  server.on('connection', (socket) =>
    socket.once('message', () => {
      for (const message of [futuresSnapshot(100), futuresDepth(110, 102, 110)]) socket.send(JSON.stringify(message))
    })
  )
  const feed = streamNormalized(
    {
      exchange: 'mexc-futures',
      symbols: ['BTC_USDT'],
      timeoutIntervalMS: 0,
      validateSequence: false,
      withDisconnectMessages: true,
      onError: (error) => errors.push(error)
    },
    normalizeBookChanges
  )
  try {
    assert.strictEqual((await feed.next()).value.isSnapshot, true)
    assert.strictEqual((await feed.next()).value.type, 'disconnect')
    assert.strictEqual(errors.length, 1)
    assert.match(errors[0].message, /snapshot has no overlap/)
  } finally {
    await feed.return?.()
    await cleanup()
  }
})
