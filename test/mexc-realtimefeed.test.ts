import { test } from 'node:test'
import type { AddressInfo } from 'net'
import { assert } from './assertions.ts'
import { createServer } from 'http'
import type { Filter } from '../dist/types.js'
import { MexcRealTimeFeed } from '../dist/realtimefeeds/mexc.js'

class TestMexcRealTimeFeed extends MexcRealTimeFeed {
  protected readonly httpURL: string

  constructor(exchange: 'mexc', filters: Filter<string>[], timeoutIntervalMS: number | undefined, httpURL = 'https://api.mexc.com') {
    super(exchange, filters, timeoutIntervalMS)
    this.httpURL = httpURL
  }

  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }

  parse(message: Buffer) {
    return this.parseMessage(message)
  }

  observe(message: any) {
    this.onMessage(message)
  }

  async provideSnapshots(filters: Filter<string>[], shouldCancel = () => false) {
    await this.provideManualSnapshots(filters, shouldCancel)
    return this.manualSnapshotsBuffer
  }
}

test('decodes the MEXC protobuf payloads used by all normalized realtime mappers', () => {
  const feed = new TestMexcRealTimeFeed('mexc', [], undefined)
  const trade = message(stringField(1, '100.1'), stringField(2, '0.2'), varintField(3, 1), varintField(4, 1710000000001))
  const publicAggreDeals = message(bytesField(1, trade), stringField(2, 'spot@public.aggre.deals.v3.api.pb@10ms'))
  const tradeWrapper = message(
    stringField(1, 'spot@public.aggre.deals.v3.api.pb@10ms@BTCUSDT'),
    stringField(3, 'BTCUSDT'),
    varintField(6, 1710000000000),
    bytesField(314, publicAggreDeals)
  )

  assert.deepStrictEqual(feed.parse(tradeWrapper), {
    channel: 'spot@public.aggre.deals.v3.api.pb@10ms@BTCUSDT',
    symbol: 'BTCUSDT',
    sendTime: '1710000000000',
    publicAggreDeals: {
      deals: [
        {
          price: '100.1',
          quantity: '0.2',
          tradeType: 1,
          time: '1710000000001'
        }
      ],
      eventType: 'spot@public.aggre.deals.v3.api.pb@10ms'
    }
  })

  const ask = message(stringField(1, '100.1'), stringField(2, '1.2'))
  const bid = message(stringField(1, '99.9'), stringField(2, '0.5'))
  const publicAggreDepths = message(
    bytesField(1, ask),
    bytesField(2, bid),
    stringField(3, 'spot@public.aggre.depth.v3.api.pb@10ms'),
    stringField(4, '101'),
    stringField(5, '102')
  )
  const depthWrapper = message(
    stringField(1, 'spot@public.aggre.depth.v3.api.pb@10ms@BTCUSDT'),
    stringField(3, 'BTCUSDT'),
    varintField(6, 1710000000000),
    bytesField(313, publicAggreDepths)
  )

  assert.deepStrictEqual(feed.parse(depthWrapper), {
    channel: 'spot@public.aggre.depth.v3.api.pb@10ms@BTCUSDT',
    symbol: 'BTCUSDT',
    sendTime: '1710000000000',
    publicAggreDepths: {
      asks: [{ price: '100.1', quantity: '1.2' }],
      bids: [{ price: '99.9', quantity: '0.5' }],
      eventType: 'spot@public.aggre.depth.v3.api.pb@10ms',
      fromVersion: '101',
      toVersion: '102'
    }
  })

  const publicAggreBookTicker = message(stringField(1, '99.9'), stringField(2, '1.2'), stringField(3, '100.1'), stringField(4, '2.3'))
  const bookTickerWrapper = message(
    stringField(1, 'spot@public.aggre.bookTicker.v3.api.pb@10ms@BTCUSDT'),
    stringField(3, 'BTCUSDT'),
    varintField(6, 1710000000000),
    bytesField(315, publicAggreBookTicker)
  )

  assert.deepStrictEqual(feed.parse(bookTickerWrapper), {
    channel: 'spot@public.aggre.bookTicker.v3.api.pb@10ms@BTCUSDT',
    symbol: 'BTCUSDT',
    sendTime: '1710000000000',
    publicAggreBookTicker: {
      bidPrice: '99.9',
      bidQuantity: '1.2',
      askPrice: '100.1',
      askQuantity: '2.3'
    }
  })
})

test('retries MEXC depth snapshots until the REST snapshot overlaps buffered WebSocket updates', async () => {
  const server = await startSnapshotServer([
    { lastUpdateId: 103, asks: [['100.3', '1.2']], bids: [['99.7', '0.5']], timestamp: 1782235749966 },
    { lastUpdateId: 104, asks: [['100.4', '1.2']], bids: [['99.6', '0.5']], timestamp: 1782235749967 }
  ])
  const feed = new TestMexcRealTimeFeed('mexc', [], undefined, server.url)
  const originalDateNow = Date.now

  Date.now = () => 1710000000000

  try {
    const filters = [
      {
        channel: 'spot@public.aggre.depth.v3.api.pb@10ms',
        symbols: ['btcusdt']
      },
      {
        channel: 'spot@public.aggre.depth.snapshot.v3.api.pb@10ms',
        symbols: ['btcusdt']
      }
    ]

    feed.map(filters)
    feed.observe({
      channel: 'spot@public.aggre.depth.v3.api.pb@10ms@BTCUSDT',
      symbol: 'BTCUSDT',
      publicAggreDepths: {
        fromVersion: '105',
        toVersion: '105'
      }
    })

    const snapshots = await feed.provideSnapshots(filters)

    assert.strictEqual(server.requestsCount, 2)
    assert.deepStrictEqual(snapshots, [
      {
        channel: 'spot@public.aggre.depth.snapshot.v3.api.pb@10ms@BTCUSDT',
        symbol: 'BTCUSDT',
        generated: true,
        publicAggreDepthsSnapshot: {
          lastUpdateId: 104,
          asks: [['100.4', '1.2']],
          bids: [['99.6', '0.5']],
          timestamp: 1782235749967
        }
      }
    ])
  } finally {
    Date.now = originalDateNow
    await server.close()
  }
})

function message(...fields: Buffer[]) {
  return Buffer.concat(fields)
}

function stringField(fieldNumber: number, value: string) {
  return bytesField(fieldNumber, Buffer.from(value))
}

function bytesField(fieldNumber: number, value: Buffer) {
  return Buffer.concat([tag(fieldNumber, 2), varint(value.length), value])
}

function varintField(fieldNumber: number, value: number) {
  return Buffer.concat([tag(fieldNumber, 0), varint(value)])
}

function tag(fieldNumber: number, wireType: number) {
  return varint(fieldNumber * 8 + wireType)
}

function varint(value: number) {
  const bytes: number[] = []
  let remaining = BigInt(value)
  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n))
    remaining >>= 7n
  }
  bytes.push(Number(remaining))
  return Buffer.from(bytes)
}

async function startSnapshotServer(
  responses: MexcTestDepthSnapshotResponse[] = [
    { lastUpdateId: 100, asks: [['100.1', '1.2']], bids: [['99.9', '0.5']], timestamp: 1782235749967 }
  ]
) {
  let requestsCount = 0
  const server = createServer((request, response) => {
    assert.strictEqual(request.url, '/api/v3/depth?symbol=BTCUSDT&limit=5000')
    const body = responses[Math.min(requestsCount, responses.length - 1)]
    requestsCount++

    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    get requestsCount() {
      return requestsCount
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

type MexcTestDepthSnapshotResponse = {
  lastUpdateId: number
  bids: string[][]
  asks: string[][]
  timestamp: number
}
