import { test } from 'node:test'
import type { AddressInfo } from 'net'
import { assert } from './assertions.ts'
import { createServer } from 'http'
import type { Filter } from '../dist/types.js'
import { MexcRealTimeFeed } from '../dist/realtimefeeds/mexc.js'
import { stream, streamNormalized, normalizeBookChanges, SequenceGapError } from '../dist/index.js'
import { createTestWebSocketServer } from './helpers/websocket.ts'

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

test('decodes every field used by the MEXC realtime protocol', () => {
  const feed = new TestMexcRealTimeFeed('mexc', [], undefined)
  const trade = message(
    stringField(1, '100.1'),
    stringField(2, '0.2'),
    varintField(3, 1),
    varintField(4, 1710000000001),
    stringField(5, 'trade-1')
  )
  const publicAggreDeals = message(bytesField(1, trade), stringField(2, 'spot@public.aggre.deals.v3.api.pb@10ms'))
  const tradeWrapper = message(
    stringField(1, 'spot@public.aggre.deals.v3.api.pb@10ms@BTCUSDT'),
    stringField(3, 'BTCUSDT'),
    stringField(4, 'btc-usdt'),
    varintField(5, 1709999999999),
    varintField(6, 1710000000000),
    bytesField(314, publicAggreDeals),
    stringField(100, 'ignored future field')
  )

  assert.deepStrictEqual(feed.parse(tradeWrapper), {
    channel: 'spot@public.aggre.deals.v3.api.pb@10ms@BTCUSDT',
    symbol: 'BTCUSDT',
    symbolId: 'btc-usdt',
    createTime: '1709999999999',
    sendTime: '1710000000000',
    publicAggreDeals: {
      deals: [
        {
          price: '100.1',
          quantity: '0.2',
          tradeType: 1,
          time: '1710000000001',
          tradeId: 'trade-1'
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
    stringField(5, '102'),
    varintField(6, 1710000000002)
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
      toVersion: '102',
      lastOrderCreateTime: '1710000000002'
    }
  })

  const publicAggreBookTicker = message(
    stringField(1, '99.9'),
    stringField(2, '1.2'),
    stringField(3, '100.1'),
    stringField(4, '2.3'),
    stringField(5, '103'),
    varintField(6, 1710000000003)
  )
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
      askQuantity: '2.3',
      version: '103',
      lastOrderCreateTime: '1710000000003'
    }
  })

  const emptyDealsWrapper = message(stringField(1, 'spot@public.aggre.deals.v3.api.pb@10ms@ETHUSDT'), bytesField(314, Buffer.alloc(0)))

  assert.deepStrictEqual(feed.parse(emptyDealsWrapper), {
    channel: 'spot@public.aggre.deals.v3.api.pb@10ms@ETHUSDT',
    publicAggreDeals: { deals: [] }
  })

  assert.deepStrictEqual(feed.parse(message(varintField(5, 9223372036854775807n))), {
    createTime: '9223372036854775807'
  })
  assert.throws(() => feed.parse(Buffer.from([0x0a, 0x02, 0x61])), /Invalid protobuf message length/)
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

function varintField(fieldNumber: number, value: number | bigint) {
  return Buffer.concat([tag(fieldNumber, 0), varint(value)])
}

function tag(fieldNumber: number, wireType: number) {
  return varint(fieldNumber * 8 + wireType)
}

function varint(value: number | bigint) {
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

function depthFrame(channel: string, fromVersion: number | string, toVersion: number | string, symbol = 'BTCUSDT', empty = false) {
  const bids = empty ? [] : [bytesField(2, message(stringField(1, '100'), stringField(2, String(toVersion))))]
  return message(
    stringField(1, `${channel}@${symbol}`),
    stringField(3, symbol),
    varintField(6, Date.now()),
    bytesField(313, message(...bids, stringField(3, channel), stringField(4, String(fromVersion)), stringField(5, String(toVersion))))
  )
}
function depthSnapshot(lastUpdateId: number) {
  return {
    channel: 'spot@public.aggre.depth.snapshot.v3.api.pb@10ms@BTCUSDT',
    symbol: 'BTCUSDT',
    generated: true,
    publicAggreDepthsSnapshot: { lastUpdateId, bids: [['100', String(lastUpdateId)]], asks: [], timestamp: Date.now() }
  }
}

for (const validateSequence of [undefined, true, false]) {
  test(`MEXC protobuf depth continuity: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const depthChannel = 'spot@public.aggre.depth.v3.api.pb@10ms'
    const errors: Error[] = []
    const native = [
      Buffer.from(JSON.stringify({ code: 0, msg: `${depthChannel}@BTCUSDT` })),
      Buffer.from(JSON.stringify({ code: 0, msg: 'PONG' })),
      depthFrame(depthChannel, 100, 105),
      depthFrame(depthChannel, 106, 110),
      depthFrame(depthChannel, 106, 110),
      depthFrame(depthChannel, 500, 501, 'ETHUSDT'),
      Buffer.from(JSON.stringify(depthSnapshot(50))),
      message(
        stringField(1, 'spot@public.aggre.bookTicker.v3.api.pb@10ms@BTCUSDT'),
        stringField(3, 'BTCUSDT'),
        bytesField(315, stringField(5, '999999'))
      ),
      depthFrame(depthChannel, 'not-a-version', '999999'),
      depthFrame(depthChannel, '', '999999'),
      depthFrame(depthChannel, 111, 115, 'BTCUSDT', true),
      depthFrame(depthChannel, 502, 505, 'ETHUSDT')
    ]
    const gap = depthFrame(depthChannel, 117, 120)
    const parser = new TestMexcRealTimeFeed('mexc', [], undefined)
    const expected = native.map((bytes) => parser.parse(bytes))
    const { server, cleanup } = await createTestWebSocketServer('mexc')
    let subscription: unknown
    server.on('connection', (socket) =>
      socket.once('message', (bytes) => {
        subscription = JSON.parse(bytes.toString())
        for (const frame of [...native, gap]) socket.send(frame)
      })
    )
    const feed = stream({
      exchange: 'mexc',
      filters: [{ channel: depthChannel, symbols: ['BTCUSDT', 'ETHUSDT'] }],
      timeoutIntervalMS: 0,
      validateSequence,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })
    try {
      for (const decoded of expected) assert.deepStrictEqual((await feed.next()).value?.message, decoded)
      assert.deepStrictEqual(subscription, { method: 'SUBSCRIPTION', params: [`${depthChannel}@BTCUSDT`, `${depthChannel}@ETHUSDT`] })
      const next = (await feed.next()).value
      if (validateSequence === false) {
        assert.deepStrictEqual(next?.message, parser.parse(gap))
        assert.deepStrictEqual(errors, [])
      } else {
        assert.strictEqual(next, undefined)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
        assert.strictEqual(errors[0].exchange, 'mexc')
        assert.strictEqual(errors[0].key, 'BTCUSDT')
        assert.strictEqual(errors[0].expectedPreviousSequence, 115)
        assert.strictEqual(errors[0].previousSequence, 116)
        assert.strictEqual(errors[0].sequence, 120)
      }
    } finally {
      await feed.return?.()
      await cleanup()
    }
  })
}

for (const normalized of [false, true]) {
  for (const withDisconnects of [false, true]) {
    test(`MEXC sequence recovery: normalized=${normalized}, disconnects=${withDisconnects}`, { timeout: 10000 }, async () => {
      const depthChannel = 'spot@public.aggre.depth.v3.api.pb@10ms'
      const errors: Error[] = []
      let connections = 0
      const initial = [
        Buffer.from(JSON.stringify(depthSnapshot(100))),
        depthFrame(depthChannel, 101, 105),
        depthFrame(depthChannel, 107, 110)
      ]
      const recovered = [Buffer.from(JSON.stringify(depthSnapshot(0))), depthFrame(depthChannel, 1, 2)]
      const { server, cleanup } = await createTestWebSocketServer('mexc')
      server.on('connection', (socket) => {
        const first = ++connections === 1
        socket.once('message', () => {
          for (const frame of first ? initial : recovered) socket.send(frame)
        })
      })
      const options = { exchange: 'mexc' as const, timeoutIntervalMS: 0, onError: (error: Error) => errors.push(error) }
      const feed = normalized
        ? streamNormalized({ ...options, symbols: ['BTCUSDT'], withDisconnectMessages: withDisconnects }, normalizeBookChanges)
        : stream({ ...options, filters: [{ channel: depthChannel, symbols: ['BTCUSDT'] }], withDisconnects })
      const output: any[] = []
      try {
        for await (const value of feed) {
          output.push(value)
          if (output.length === (withDisconnects ? 5 : 4)) break
        }
        if (withDisconnects) {
          assert.strictEqual(normalized ? output[2].type : output[2], normalized ? 'disconnect' : undefined)
          output.splice(2, 1)
        }
        if (normalized) {
          assert.deepStrictEqual(
            output.map((item) => item.isSnapshot),
            [true, false, true, false]
          )
          assert.deepStrictEqual(
            output.map((item) => item.bids),
            [100, 105, 0, 2].map((amount) => [{ price: 100, amount }])
          )
        } else {
          const parser = new TestMexcRealTimeFeed('mexc', [], undefined)
          assert.deepStrictEqual(
            output.map((item) => item.message),
            [...initial.slice(0, 2), ...recovered].map((bytes) => parser.parse(bytes))
          )
        }
        assert.strictEqual(connections, 2)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
      } finally {
        await feed.return?.()
        await cleanup()
      }
    })
  }
}

test('MEXC normalized opt-out preserves snapshot mapping across a gap', { timeout: 10000 }, async () => {
  const depthChannel = 'spot@public.aggre.depth.v3.api.pb@10ms'
  const errors: Error[] = []
  const { server, cleanup } = await createTestWebSocketServer('mexc')
  server.on('connection', (socket) =>
    socket.once('message', () => {
      for (const frame of [
        Buffer.from(JSON.stringify(depthSnapshot(100))),
        depthFrame(depthChannel, 101, 105),
        depthFrame(depthChannel, 107, 110)
      ])
        socket.send(frame)
    })
  )
  const feed = streamNormalized(
    { exchange: 'mexc', symbols: ['BTCUSDT'], timeoutIntervalMS: 0, validateSequence: false, onError: (error) => errors.push(error) },
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
