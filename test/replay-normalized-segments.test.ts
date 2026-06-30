import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { jest } from '@jest/globals'

const workerPayloads: any[] = []
const tempDirs: string[] = []

class MockWorker extends EventEmitter {
  constructor(_url: URL, options: { workerData: any }) {
    super()

    const payload = options.workerData
    workerPayloads.push(payload)
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-replay-normalized-segments-'))
    tempDirs.push(tempDir)

    setImmediate(() => {
      const slicePath = path.join(tempDir, `${payload.fromDate.toISOString().replace(/[:.]/g, '-')}.json.gz`)
      mkdirSync(path.dirname(slicePath), { recursive: true })
      writeFileSync(slicePath, gzipSync(`${formatReplayTimestamp(payload.fromDate)} ${JSON.stringify(createMessage(payload))}\n`))

      this.emit('message', {
        sliceKey: payload.fromDate.toISOString(),
        slicePath,
        sliceSize: Math.floor((payload.toDate.valueOf() - payload.fromDate.valueOf()) / 60_000)
      })
    })
  }

  postMessage(signal: string) {
    if (signal === 'BEFORE_TERMINATE') {
      setImmediate(() => this.emit('message', 'READY_TO_TERMINATE'))
    }
  }

  async terminate() {
    return 0
  }
}

jest.unstable_mockModule('worker_threads', () => ({
  Worker: MockWorker,
  isMainThread: true,
  parentPort: undefined,
  workerData: undefined
}))

const { normalizeBookChanges, normalizeTrades, replayNormalized } = await import('../dist/index.js')

afterEach(() => {
  workerPayloads.length = 0

  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { force: true, recursive: true })
  }
})

test('replayNormalized keeps one replay segment for multi-day ranges without mapper switches', async () => {
  const messages = []
  for await (const message of replayNormalized(
    {
      exchange: 'bitmex',
      symbols: ['ETHUSD'],
      from: '2019-05-01T00:00:00.000Z',
      to: '2019-05-06T00:00:00.000Z'
    },
    normalizeTrades
  )) {
    messages.push(message)
  }

  expect(messages).toHaveLength(1)
  expect(messages.map((message) => message.timestamp.toISOString())).toEqual(['2019-05-01T00:00:00.000Z'])
  expect(workerPayloads.map((payload) => [payload.fromDate.toISOString(), payload.toDate.toISOString()])).toEqual([
    ['2019-05-01T00:00:00.000Z', '2019-05-06T00:00:00.000Z']
  ])
  expect(workerPayloads.map((payload) => payload.filters)).toEqual([[{ channel: 'trade', symbols: ['ETHUSD'] }]])
})

test('replayNormalized creates replay segments at mapper switch dates', async () => {
  const messages = []
  for await (const message of replayNormalized(
    {
      exchange: 'bitget',
      symbols: ['BTCUSDT'],
      from: '2026-04-27T23:59:00.000Z',
      to: '2026-04-28T00:01:00.000Z'
    },
    normalizeTrades
  )) {
    messages.push(message)
  }

  expect(messages).toHaveLength(2)
  expect(messages.map((message) => message.timestamp.toISOString())).toEqual(['2026-04-27T23:59:00.000Z', '2026-04-28T00:00:00.000Z'])
  expect(workerPayloads.map((payload) => [payload.fromDate.toISOString(), payload.toDate.toISOString()])).toEqual([
    ['2026-04-27T23:59:00.000Z', '2026-04-28T00:00:00.000Z'],
    ['2026-04-28T00:00:00.000Z', '2026-04-28T00:01:00.000Z']
  ])
  expect(workerPayloads.map((payload) => payload.filters)).toEqual([
    [{ channel: 'trade', symbols: ['BTCUSDT'] }],
    [{ channel: 'publicTrade', symbols: ['BTCUSDT'] }]
  ])
})

test('replayNormalized segments OKX book changes at public books channel boundaries', async () => {
  const okxEnv = {
    OKX_API_KEY: process.env.OKX_API_KEY,
    OKX_API_VIP_5: process.env.OKX_API_VIP_5,
    OKX_API_COLO: process.env.OKX_API_COLO
  }

  delete process.env.OKX_API_KEY
  delete process.env.OKX_API_VIP_5
  delete process.env.OKX_API_COLO

  try {
    const messages = []
    for await (const message of replayNormalized(
      {
        exchange: 'okex',
        symbols: ['BTC-USDT'],
        from: '2023-02-24T23:59:00.000Z',
        to: '2023-03-09T00:01:00.000Z'
      },
      normalizeBookChanges
    )) {
      messages.push(message)
    }

    expect(messages).toHaveLength(3)
    expect(messages.map((message) => message.timestamp.toISOString())).toEqual([
      '2023-02-24T23:59:00.000Z',
      '2023-02-25T00:00:00.000Z',
      '2023-03-09T00:00:00.000Z'
    ])
    expect(workerPayloads.map((payload) => [payload.fromDate.toISOString(), payload.toDate.toISOString()])).toEqual([
      ['2023-02-24T23:59:00.000Z', '2023-02-25T00:00:00.000Z'],
      ['2023-02-25T00:00:00.000Z', '2023-03-09T00:00:00.000Z'],
      ['2023-03-09T00:00:00.000Z', '2023-03-09T00:01:00.000Z']
    ])
    expect(workerPayloads.map((payload) => payload.filters)).toEqual([
      [{ channel: 'books-l2-tbt', symbols: ['BTC-USDT'] }],
      [{ channel: 'books', symbols: ['BTC-USDT'] }],
      [{ channel: 'books-l2-tbt', symbols: ['BTC-USDT'] }]
    ])
  } finally {
    restoreEnv(okxEnv)
  }
})

test('replayNormalized segments WOO X book changes at the V3 raw payload boundary', async () => {
  const messages = []
  for await (const message of replayNormalized(
    {
      exchange: 'woo-x',
      symbols: ['PERP_BTC_USDT'],
      from: '2026-06-29T22:01:00.000Z',
      to: '2026-06-29T22:03:00.000Z'
    },
    normalizeBookChanges
  )) {
    messages.push(message)
  }

  expect(messages).toHaveLength(2)
  expect(messages.map((message) => message.timestamp.toISOString())).toEqual(['2026-06-29T22:01:00.000Z', '2026-06-29T22:02:00.000Z'])
  expect(workerPayloads.map((payload) => [payload.fromDate.toISOString(), payload.toDate.toISOString()])).toEqual([
    ['2026-06-29T22:01:00.000Z', '2026-06-29T22:02:00.000Z'],
    ['2026-06-29T22:02:00.000Z', '2026-06-29T22:03:00.000Z']
  ])
  expect(workerPayloads.map((payload) => payload.filters)).toEqual([
    [
      { channel: 'orderbook', symbols: ['PERP_BTC_USDT'] },
      { channel: 'orderbookupdate', symbols: ['PERP_BTC_USDT'] }
    ],
    [
      { channel: 'orderbook', symbols: ['PERP_BTC_USDT'] },
      { channel: 'orderbookupdate', symbols: ['PERP_BTC_USDT'] }
    ]
  ])
})

function createMessage(payload: any) {
  const filter = payload.filters[0]
  const symbol = filter.symbols[0]

  if (payload.exchange === 'bitmex') {
    return {
      table: 'trade',
      action: 'insert',
      data: [
        {
          timestamp: payload.fromDate.toISOString(),
          symbol,
          side: 'Buy',
          size: 1,
          price: 200,
          trdMatchID: `${payload.fromDate.valueOf()}`
        }
      ]
    }
  }

  if (payload.exchange === 'woo-x') {
    if (payload.fromDate.valueOf() < Date.parse('2026-06-29T22:02:00.000Z')) {
      return {
        id: `${symbol}@orderbook`,
        event: 'request',
        success: true,
        ts: payload.fromDate.valueOf(),
        data: {
          symbol,
          ts: payload.fromDate.valueOf(),
          bids: [[100, 1]],
          asks: [[101, 2]]
        }
      }
    }

    return {
      topic: `orderbook@${symbol}@50`,
      ts: payload.fromDate.valueOf(),
      generated: true,
      data: {
        s: symbol,
        ts: payload.fromDate.valueOf(),
        bids: [['100', '1']],
        asks: [['101', '2']]
      }
    }
  }

  if (filter.channel === 'trade') {
    return {
      action: 'update',
      arg: { channel: 'trade', instId: symbol },
      data: [{ ts: String(payload.fromDate.valueOf()), price: '1', size: '2', side: 'buy', tradeId: `${payload.fromDate.valueOf()}` }]
    }
  }

  if (payload.exchange === 'okex') {
    return {
      action: 'snapshot',
      arg: { channel: filter.channel, instId: symbol },
      data: [{ ts: String(payload.fromDate.valueOf()), bids: [['100', '1']], asks: [['101', '2']] }]
    }
  }

  return {
    action: 'update',
    arg: { topic: 'publicTrade', symbol },
    data: [{ T: payload.fromDate.valueOf(), p: '1', v: '2', S: 'buy', i: `${payload.fromDate.valueOf()}` }]
  }
}

function formatReplayTimestamp(date: Date) {
  return date.toISOString().slice(0, -1) + '0000Z'
}

function restoreEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
