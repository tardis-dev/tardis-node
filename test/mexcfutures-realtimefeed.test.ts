import { test } from 'node:test'
import type { AddressInfo } from 'net'
import { assert } from './assertions.ts'
import { createServer } from 'http'
import type { Filter } from '../dist/types.js'
import { MexcFuturesRealTimeFeed } from '../dist/realtimefeeds/mexcfutures.js'
import { stream, streamNormalized, normalizeBookChanges, SequenceGapError } from '../dist/index.js'
import { createTestWebSocketServer } from './helpers/websocket.ts'
import { message, stringField, bytesField, varintField } from './helpers/protobuf.ts'
import { decodeMexcFuturesProtobufMessage } from '../dist/realtimefeeds/mexcfuturesprotobuf.js'

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

test('aligns MEXC Futures Protobuf depth updates with a REST snapshot', async () => {
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
    feed.observe(futuresDepth(1))

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
    feed.observe(futuresDepth(105))

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

// ContractWrapper + DepthMerge field numbers from MEXC's official .proto files.
function futuresDepthFrame(begin: number, end: number, symbol = 'BTC_USDT', empty = false) {
  const bids = empty ? [] : [bytesField(2, message(stringField(1, '100'), stringField(2, String(end)), varintField(3, 1)))]
  const depth = message(...bids, varintField(3, begin), varintField(4, end))
  return message(stringField(1, symbol), stringField(2, 'push.depth'), varintField(3, 1794300000000), bytesField(2016, depth))
}

function futuresDepth(endVersion: number, beginVersion = endVersion, symbol = 'BTC_USDT', empty = false) {
  return decodeMexcFuturesProtobufMessage(futuresDepthFrame(beginVersion, endVersion, symbol, empty))
}
function encodeFuturesMessage(message: any) {
  if (message.channel !== 'push.depth') return JSON.stringify(message)
  return futuresDepthFrame(
    Number(message.depthMerge.beginVersion),
    Number(message.depthMerge.endVersion),
    message.symbol,
    !message.depthMerge.bids?.length
  )
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

for (const validateSequence of [true, false]) {
  test(`MEXC Futures depth continuity: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const valid: any[] = [
      { channel: 'rs.sub.depth', data: 'success' },
      { channel: 'pong', data: 1794300000000 },
      futuresDepth(105, 100),
      futuresDepth(110, 106),
      futuresDepth(110, 106),
      futuresDepth(115, 111, 'BTC_USDT', true),
      futuresDepth(116),
      futuresDepth(117),
      futuresDepth(120, 118),
      futuresDepth(122, 121),
      futuresDepth(505, 500, 'ETH_USDT'),
      futuresSnapshot(50),
      { channel: 'push.ticker', symbol: 'BTC_USDT', data: { version: 999999 } },
      futuresDepth(506, 506, 'ETH_USDT')
    ].map((message) => JSON.parse(JSON.stringify(message)))
    const gap = futuresDepth(125, 124),
      errors: Error[] = []
    const { server, cleanup } = await createFuturesSequenceServer()
    server.on('connection', (socket) =>
      socket.once('message', (bytes) => {
        assert.deepStrictEqual(JSON.parse(bytes.toString()), {
          method: 'sub.depth',
          param: { symbol: 'BTC_USDT', compress: true },
          gzip: false
        })
        for (const message of [...valid, gap]) socket.send(encodeFuturesMessage(message))
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
      for (const message of valid) {
        const next = await feed.next()
        assert.deepStrictEqual(errors, [])
        assert.deepStrictEqual(next.value?.message, message)
      }
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
        initial = [futuresSnapshot(100), futuresDepth(105, 101), futuresDepth(110, 107)],
        recovered = [futuresSnapshot(0), futuresDepth(2, 1)]
      const { server, cleanup } = await createFuturesSequenceServer()
      server.on('connection', (socket) => {
        const first = ++connections === 1
        socket.once('message', () => {
          for (const message of (first ? initial : recovered) as any[]) socket.send(encodeFuturesMessage(message))
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

test('MEXC Futures normalized opt-out retains initial snapshot overlap validation', { timeout: 10000 }, async () => {
  const errors: Error[] = [],
    { server, cleanup } = await createFuturesSequenceServer()
  server.on('connection', (socket) =>
    socket.once('message', () => {
      for (const message of [futuresSnapshot(100), futuresDepth(110, 102)] as any[]) socket.send(encodeFuturesMessage(message))
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
