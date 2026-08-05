import type { AddressInfo } from 'net'
import { createServer } from 'http'
import { AsterFuturesRealTimeFeed, AsterRealTimeFeed } from '../src/realtimefeeds/aster.ts'
import { getRealTimeFeedFactory } from '../src/realtimefeeds/index.ts'
import { Filter } from '../src/types.ts'

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

  observe(message: any) {
    this.onMessage(message)
  }

  async provideSnapshots(filters: Filter<string>[], shouldCancel = () => false) {
    await this.provideManualSnapshots(filters, shouldCancel)
    return this.manualSnapshotsBuffer
  }
}

class TestAsterFuturesRealTimeFeed extends AsterFuturesRealTimeFeed {
  protected readonly httpURL: string

  constructor(
    exchange: 'aster-futures',
    filters: Filter<string>[],
    timeoutIntervalMS: number | undefined,
    httpURL = 'https://fapi.asterdex.com/fapi/v1'
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

test('register aster realtime feeds', () => {
  expect(getRealTimeFeedFactory('aster')).toBeDefined()
  expect(getRealTimeFeedFactory('aster-futures')).toBeDefined()
})

test('map aster realtime subscriptions', () => {
  const feed = new TestAsterRealTimeFeed('aster', [], undefined)

  expect(
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
      }
    ])
  ).toEqual([
    {
      method: 'SUBSCRIBE',
      params: ['btcusdt@depth@100ms'],
      id: 1
    },
    {
      method: 'SUBSCRIBE',
      params: ['btcusdt@trade', 'ethusdt@trade'],
      id: 2
    }
  ])
})

test('aster snapshot filters require matching depth filters', () => {
  const feed = new TestAsterRealTimeFeed('aster', [], undefined)

  expect(() =>
    feed.map([
      {
        channel: 'depthSnapshot',
        symbols: ['BTCUSDT']
      }
    ])
  ).toThrow('AsterRealTimeFeed requires depth for every depthSnapshot symbol')

  expect(() =>
    feed.map([
      {
        channel: 'depth',
        symbols: ['ETHUSDT']
      },
      {
        channel: 'depthSnapshot',
        symbols: ['BTCUSDT']
      }
    ])
  ).toThrow('AsterRealTimeFeed requires depth for every depthSnapshot symbol')
})

test('aster realtime rejects unsupported channels', () => {
  const feed = new TestAsterRealTimeFeed('aster', [], undefined)

  expect(() =>
    feed.map([
      {
        channel: 'unsupported',
        symbols: ['BTCUSDT']
      }
    ])
  ).toThrow('AsterRealTimeFeed unsupported channel unsupported')
})

test('map aster futures realtime subscriptions', () => {
  const feed = new TestAsterFuturesRealTimeFeed('aster-futures', [], undefined)

  expect(
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
        channel: 'markPrice',
        symbols: ['btcusdt']
      },
      {
        channel: 'forceOrder',
        symbols: ['btcusdt']
      }
    ])
  ).toEqual([
    {
      method: 'SUBSCRIBE',
      params: ['btcusdt@depth@100ms'],
      id: 1
    },
    {
      method: 'SUBSCRIBE',
      params: ['btcusdt@markPrice@1s'],
      id: 2
    },
    {
      method: 'SUBSCRIBE',
      params: ['btcusdt@forceOrder'],
      id: 3
    }
  ])
})

test('provide aster manual depth snapshots after buffered update overlaps', async () => {
  const server = await startSnapshotServer([{ lastUpdateId: 100, asks: [['100.1', '1.2']], bids: [['99.9', '0.5']] }])
  const feed = new TestAsterRealTimeFeed('aster', [], undefined, server.url)

  try {
    const filters = [
      {
        channel: 'depth',
        symbols: ['BTCUSDT']
      },
      {
        channel: 'depthSnapshot',
        symbols: ['BTCUSDT']
      }
    ]

    feed.map(filters)
    feed.observe(createDepthUpdate({ symbol: 'BTCUSDT', lastUpdateId: 101, previousFinalUpdateId: 100 }))

    const snapshots = await feed.provideSnapshots(filters)

    expect(snapshots).toEqual([
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

test('retry aster manual depth snapshots until buffered update overlaps', async () => {
  const server = await startSnapshotServer([
    { lastUpdateId: 102, asks: [['100.1', '1.2']], bids: [['99.9', '0.5']] },
    { lastUpdateId: 104, asks: [['100.2', '1.2']], bids: [['99.8', '0.5']] }
  ])
  const feed = new TestAsterRealTimeFeed('aster', [], undefined, server.url)

  try {
    const filters = [
      {
        channel: 'depth',
        symbols: ['BTCUSDT']
      },
      {
        channel: 'depthSnapshot',
        symbols: ['BTCUSDT']
      }
    ]

    feed.map(filters)
    feed.observe(createDepthUpdate({ symbol: 'BTCUSDT', lastUpdateId: 105, previousFinalUpdateId: 104 }))

    const snapshots = await feed.provideSnapshots(filters)

    expect(server.requestsCount).toBe(2)
    expect(snapshots).toEqual([
      {
        stream: 'btcusdt@depthSnapshot',
        generated: true,
        data: {
          lastUpdateId: 104,
          asks: [['100.2', '1.2']],
          bids: [['99.8', '0.5']]
        }
      }
    ])
  } finally {
    await server.close()
  }
})

test('retry aster futures manual depth snapshots until first update overlaps', async () => {
  const server = await startSnapshotServer([
    { lastUpdateId: 104, asks: [['100.1', '1.2']], bids: [['99.9', '0.5']] },
    { lastUpdateId: 105, asks: [['100.2', '1.2']], bids: [['99.8', '0.5']] }
  ])
  const feed = new TestAsterFuturesRealTimeFeed('aster-futures', [], undefined, server.url)

  try {
    const filters = [
      {
        channel: 'depth',
        symbols: ['BTCUSDT']
      },
      {
        channel: 'depthSnapshot',
        symbols: ['BTCUSDT']
      }
    ]

    feed.map(filters)
    feed.observe(createDepthUpdate({ symbol: 'BTCUSDT', firstUpdateId: 105, lastUpdateId: 105, previousFinalUpdateId: 106 }))

    const snapshots = await feed.provideSnapshots(filters)

    expect(server.requestsCount).toBe(2)
    expect(snapshots).toEqual([
      {
        stream: 'btcusdt@depthSnapshot',
        generated: true,
        data: {
          lastUpdateId: 105,
          asks: [['100.2', '1.2']],
          bids: [['99.8', '0.5']]
        }
      }
    ])
  } finally {
    await server.close()
  }
})

function createDepthUpdate({
  symbol,
  firstUpdateId,
  lastUpdateId,
  previousFinalUpdateId
}: {
  symbol: string
  firstUpdateId?: number
  lastUpdateId: number
  previousFinalUpdateId: number
}) {
  return {
    stream: `${symbol.toLowerCase()}@depth@100ms`,
    data: {
      e: 'depthUpdate',
      E: 1785230774524,
      T: 1785230774522,
      s: symbol,
      U: firstUpdateId ?? previousFinalUpdateId + 1,
      u: lastUpdateId,
      pu: previousFinalUpdateId,
      b: [],
      a: []
    }
  }
}

async function startSnapshotServer(responses: AsterTestDepthSnapshotResponse[]) {
  let requestsCount = 0
  const server = createServer((request, response) => {
    expect(request.url).toBe('/depth?symbol=BTCUSDT&limit=1000')
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

type AsterTestDepthSnapshotResponse = {
  lastUpdateId: number
  bids: string[][]
  asks: string[][]
}
