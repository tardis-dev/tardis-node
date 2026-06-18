import type { AddressInfo } from 'net'
import { createServer } from 'http'
import { Filter } from '../src/types.ts'
import { MexcFuturesRealTimeFeed } from '../src/realtimefeeds/mexcfutures.ts'

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

test('map mexc futures stored push channels to subscription methods', () => {
  const feed = new TestMexcFuturesRealTimeFeed('mexc-futures', [], undefined)

  expect(
    feed.map([
      {
        channel: 'push.deal',
        symbols: ['BTC_USDT', 'ETH_USDT']
      },
      {
        channel: 'push.depth',
        symbols: ['BTC_USDT']
      },
      {
        channel: 'push.funding.rate',
        symbols: ['BTC_USDT']
      },
      {
        channel: 'push.contract'
      }
    ])
  ).toEqual([
    {
      method: 'sub.deal',
      param: { symbol: 'BTC_USDT' },
      gzip: false
    },
    {
      method: 'sub.deal',
      param: { symbol: 'ETH_USDT' },
      gzip: false
    },
    {
      method: 'sub.depth',
      param: { symbol: 'BTC_USDT' },
      gzip: false
    },
    {
      method: 'sub.funding.rate',
      param: { symbol: 'BTC_USDT' },
      gzip: false
    },
    {
      method: 'sub.contract'
    }
  ])
})

test('mexc futures realtime subscriptions require symbols', () => {
  const feed = new TestMexcFuturesRealTimeFeed('mexc-futures', [], undefined)

  expect(() =>
    feed.map([
      {
        channel: 'push.deal'
      }
    ])
  ).toThrow('MexcFuturesRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
})

test('provide mexc futures manual depth snapshots', async () => {
  const server = await startSnapshotServer()
  const feed = new TestMexcFuturesRealTimeFeed('mexc-futures', [], undefined, server.url)
  const originalDateNow = Date.now

  Date.now = () => 1779703618000

  try {
    const filters = [
      {
        channel: 'push.depth',
        symbols: ['btc_usdt']
      }
    ]

    feed.map(filters)
    feed.observe({
      symbol: 'BTC_USDT',
      data: {
        asks: [],
        bids: [[75228, 32, 4]],
        begin: 101,
        end: 101,
        version: 101
      },
      channel: 'push.depth',
      ts: 1779703618133
    })

    const snapshots = await feed.provideSnapshots(filters)

    expect(snapshots).toEqual([
      {
        symbol: 'BTC_USDT',
        generated: true,
        channel: 'push.depth',
        ts: 1779703618000,
        data: {
          asks: [[75230, 1, 1]],
          bids: [[75220, 2, 2]],
          version: 100
        }
      }
    ])
  } finally {
    Date.now = originalDateNow
    await server.close()
  }
})

test('retry mexc futures manual depth snapshots until buffered update overlaps', async () => {
  const server = await startSnapshotServer([
    { success: true, code: 0, data: { asks: [[75230, 1, 1]], bids: [[75220, 2, 2]], version: 102 } },
    { success: true, code: 0, data: { asks: [[75233, 1, 1]], bids: [[75217, 2, 2]], version: 104 } }
  ])
  const feed = new TestMexcFuturesRealTimeFeed('mexc-futures', [], undefined, server.url)
  const originalDateNow = Date.now

  Date.now = () => 1779703618000

  try {
    const filters = [
      {
        channel: 'push.depth',
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
        end: 105,
        version: 105
      },
      channel: 'push.depth',
      ts: 1779703618133
    })

    const snapshots = await feed.provideSnapshots(filters)

    expect(server.requestsCount).toBe(2)
    expect(snapshots).toEqual([
      {
        symbol: 'BTC_USDT',
        generated: true,
        channel: 'push.depth',
        ts: 1779703618000,
        data: {
          asks: [[75233, 1, 1]],
          bids: [[75217, 2, 2]],
          version: 104
        }
      }
    ])
  } finally {
    Date.now = originalDateNow
    await server.close()
  }
})

async function startSnapshotServer(
  responses: MexcFuturesTestDepthSnapshotResponse[] = [
    { success: true, code: 0, data: { asks: [[75230, 1, 1]], bids: [[75220, 2, 2]], version: 100 } }
  ]
) {
  let requestsCount = 0
  const server = createServer((request, response) => {
    expect(request.url).toBe('/api/v1/contract/depth/BTC_USDT?limit=1000')
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
    asks: number[][]
    bids: number[][]
    version: number
  }
}
