import type { AddressInfo } from 'net'
import { createServer } from 'http'
import { test } from 'node:test'
import { assert, errorMessageIncludes } from './assertions.ts'
import { AsterFuturesWebSocketRealTimeFeed, AsterRealTimeFeed } from '../dist/realtimefeeds/aster.js'
import { getRealTimeFeedFactory } from '../dist/realtimefeeds/index.js'
import type { Filter } from '../dist/types.js'

class TestAsterRealTimeFeed extends AsterRealTimeFeed {
  protected readonly httpURL: string

  constructor(
    exchange: 'aster',
    filters: Filter<string>[],
    timeoutIntervalMS: number | undefined,
    httpURL = 'https://sapi.asterdex.com/api/v3'
  ) {
    super(exchange, filters, timeoutIntervalMS)
    this.httpURL = httpURL
  }

  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }

  async provideSnapshots(filters: Filter<string>[], shouldCancel = () => false) {
    await this.provideManualSnapshots(filters, shouldCancel)
    return this.manualSnapshotsBuffer
  }
}

class TestAsterFuturesRealTimeFeed extends AsterFuturesWebSocketRealTimeFeed {
  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }
}

test('register aster realtime feeds', () => {
  assert.ok(getRealTimeFeedFactory('aster'))
  assert.ok(getRealTimeFeedFactory('aster-futures'))
})

test('map aster realtime subscriptions', () => {
  const feed = new TestAsterRealTimeFeed('aster', [], undefined)

  assert.deepEqual(
    feed.map([
      {
        channel: 'depth',
        symbols: ['btcusdt']
      },
      {
        channel: 'depthSnapshot',
        symbols: ['btcusdt']
      },
      {
        channel: 'trade',
        symbols: ['btcusdt', 'ethusdt']
      },
      {
        channel: 'aggTrade',
        symbols: ['btcusdt']
      }
    ]),
    [
      {
        method: 'SUBSCRIBE',
        params: ['btcusdt@depth@0ms'],
        id: 1
      },
      {
        method: 'SUBSCRIBE',
        params: ['btcusdt@trade', 'ethusdt@trade'],
        id: 2
      },
      {
        method: 'SUBSCRIBE',
        params: ['btcusdt@aggTrade'],
        id: 3
      }
    ]
  )
})

test('aster snapshot filters require matching depth filters', () => {
  const feed = new TestAsterRealTimeFeed('aster', [], undefined)

  assert.throws(
    () =>
      feed.map([
        {
          channel: 'depthSnapshot',
          symbols: ['BTCUSDT']
        }
      ]),
    errorMessageIncludes('AsterRealTimeFeed requires depth for every depthSnapshot symbol')
  )

  assert.throws(
    () =>
      feed.map([
        {
          channel: 'depth',
          symbols: ['ETHUSDT']
        },
        {
          channel: 'depthSnapshot',
          symbols: ['BTCUSDT']
        }
      ]),
    errorMessageIncludes('AsterRealTimeFeed requires depth for every depthSnapshot symbol')
  )
})

test('aster realtime rejects unsupported channels', () => {
  const feed = new TestAsterRealTimeFeed('aster', [], undefined)

  assert.throws(
    () =>
      feed.map([
        {
          channel: 'unsupported',
          symbols: ['BTCUSDT']
        }
      ]),
    errorMessageIncludes('AsterRealTimeFeed unsupported channel unsupported')
  )
})

test('map aster futures realtime subscriptions', () => {
  const feed = new TestAsterFuturesRealTimeFeed('aster-futures', [], undefined)

  assert.deepEqual(
    feed.map([
      {
        channel: 'depth',
        symbols: ['btcusdt']
      },
      {
        channel: 'depthSnapshot',
        symbols: ['btcusdt']
      },
      {
        channel: 'trade',
        symbols: ['btcusdt']
      },
      {
        channel: 'markPrice',
        symbols: ['btcusdt']
      },
      {
        channel: 'forceOrder',
        symbols: ['btcusdt']
      },
      {
        channel: 'assetIndex',
        symbols: ['btcusd']
      }
    ]),
    [
      {
        method: 'SUBSCRIBE',
        params: ['btcusdt@depth@0ms'],
        id: 1
      },
      {
        method: 'SUBSCRIBE',
        params: ['btcusdt@trade'],
        id: 2
      },
      {
        method: 'SUBSCRIBE',
        params: ['btcusdt@markPrice@1s'],
        id: 3
      },
      {
        method: 'SUBSCRIBE',
        params: ['btcusdt@forceOrder'],
        id: 4
      },
      {
        method: 'SUBSCRIBE',
        params: ['btcusd@assetIndex'],
        id: 5
      }
    ]
  )
})

test('provide aster manual depth snapshot', async () => {
  const server = await startSnapshotServer({ lastUpdateId: 100, asks: [['100.1', '1.2']], bids: [['99.9', '0.5']] })
  const feed = new TestAsterRealTimeFeed('aster', [], undefined, server.url)

  try {
    const filters = [
      {
        channel: 'depth',
        symbols: ['btcusdt']
      },
      {
        channel: 'depthSnapshot',
        symbols: ['btcusdt']
      }
    ]

    const snapshots = await feed.provideSnapshots(filters)

    assert.equal(server.requestsCount, 1)
    assert.deepEqual(snapshots, [
      {
        stream: 'btcusdt@depthSnapshot',
        generated: true,
        data: {
          lastUpdateId: 100,
          asks: [['100.1', '1.2']],
          bids: [['99.9', '0.5']]
        }
      }
    ])
  } finally {
    await server.close()
  }
})

async function startSnapshotServer(snapshot: AsterTestDepthSnapshotResponse) {
  let requestsCount = 0
  const server = createServer((request, response) => {
    if (request.url === '/exchangeInfo') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'x-mbx-used-weight-1m': '1' })
      response.end(JSON.stringify({ rateLimits: [{ rateLimitType: 'REQUEST_WEIGHT', limit: 6000 }] }))
      return
    }

    assert.equal(request.url, '/depth?symbol=BTCUSDT&limit=1000')
    requestsCount++

    response.writeHead(200, { 'Content-Type': 'application/json', 'x-mbx-used-weight-1m': '21' })
    response.end(JSON.stringify(snapshot))
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

type AsterTestDepthSnapshotResponse = {
  lastUpdateId: number
  bids: string[][]
  asks: string[][]
}
