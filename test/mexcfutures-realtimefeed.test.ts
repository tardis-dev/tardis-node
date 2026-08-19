import { test } from 'node:test'
import type { AddressInfo } from 'net'
import { assert } from './assertions.ts'
import { createServer } from 'http'
import type { Filter } from '../dist/types.js'
import { MexcFuturesRealTimeFeed } from '../dist/realtimefeeds/mexcfutures.js'

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
