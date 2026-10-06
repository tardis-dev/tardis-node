import { afterEach, mock, test } from 'node:test'
import { EventEmitter, once } from 'node:events'
import { assert, errorMessageIncludes } from './assertions.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { WebSocketServer } from 'ws'

const tempDirs: string[] = []
let feed = ''
let workerError: Error | undefined

class MockWorker extends EventEmitter {
  constructor(_url: URL, options: { workerData: any }) {
    super()

    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-replay-normalized-batching-'))
    tempDirs.push(tempDir)

    setImmediate(() => {
      if (workerError !== undefined) {
        this.emit('error', workerError)
        return
      }

      const slicePath = path.join(tempDir, 'slice.json.gz')
      writeFileSync(slicePath, gzipSync(feed))
      this.emit('message', {
        sliceKey: options.workerData.fromDate.toISOString(),
        slicePath,
        sliceSize: 1
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

mock.module('worker_threads', {
  exports: {
    Worker: MockWorker,
    isMainThread: true,
    parentPort: undefined,
    workerData: undefined
  }
})

const { normalizeTrades, replay, replayNormalized, stream } = await import('../dist/index.js')

afterEach(() => {
  feed = ''
  workerError = undefined
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { force: true, recursive: true })
  }
})

test('preserves mapper order, disconnects, and microsecond timestamps across a replay batch', async () => {
  feed = [line(1), line(2), '', '', line(3, '30.1234567')].join('\n') + '\n'

  const instances = new Map<string, number>()
  const messages = []
  for await (const message of replayNormalized(
    normalizedOptions(true),
    resetAwareNormalizer('first', instances),
    resetAwareNormalizer('second', instances)
  )) {
    messages.push(message)
  }

  assert.deepStrictEqual(
    messages.map((message) => (message.type === 'disconnect' ? 'disconnect' : 'id' in message ? message.id : message.type)),
    ['first-1-1', 'second-1-1', 'first-1-2', 'second-1-2', 'disconnect', 'first-2-3', 'second-2-3']
  )
  assert.deepStrictEqual(Object.fromEntries(instances), { first: 2, second: 2 })
  const lastMessage = messages.at(-1)
  assert.ok(lastMessage !== undefined && lastMessage.type === 'trade')
  assert.strictEqual(lastMessage.localTimestamp.toISOString(), '2026-07-01T00:00:30.123Z')
  assert.strictEqual(lastMessage.localTimestamp.μs, 456)
})

test('stops processing and closes a custom mapper when the consumer cancels', async () => {
  feed = `${line(1)}\n${line(2)}\n`
  const calls: string[] = []
  const iterator = replayNormalized(normalizedOptions(), closableNormalizer(calls))

  assert.strictEqual((await iterator.next()).value.id, 'closable-1')
  await iterator.return?.()

  assert.deepStrictEqual(calls, ['map:closable:1', 'close:closable'])
})

test('yields earlier messages before surfacing a later mapper error', async () => {
  feed = `${line(1)}\n${line(2)}\n`
  const calls: string[] = []
  const iterator = replayNormalized(normalizedOptions(), throwingNormalizer(calls))

  assert.strictEqual((await iterator.next()).value.id, 'throwing-1')
  await assert.rejects(iterator.next(), errorMessageIncludes('mapper failed on 2'))
  assert.deepStrictEqual(calls, ['map:throwing:1', 'map:throwing:2'])
})

test('yields earlier normalized messages before surfacing a later JSON error', async () => {
  feed = `${line(1)}\n2026-07-01T00:00:00.0000001Z {invalid\n`
  const iterator = replayNormalized(normalizedOptions(), normalizer('first'))

  assert.strictEqual((await iterator.next()).value.id, 'first-1')
  await assert.rejects(iterator.next(), SyntaxError)
})

test('emits one disconnect marker for consecutive recorder gaps and preserves microseconds', async () => {
  feed = [line(1, '00.0000010'), '', '', line(2, '00.0000020')].join('\n') + '\n'
  const iterator = replay(rawOptions({ withDisconnects: true, withMicroseconds: true }))

  const first = (await iterator.next()).value
  assert.ok(first !== undefined)
  assert.deepStrictEqual(first.message, { sequence: 1 })
  assert.strictEqual(first.localTimestamp.μs, 1)
  assert.strictEqual((await iterator.next()).value, undefined)
  const second = (await iterator.next()).value
  assert.ok(second !== undefined)
  assert.deepStrictEqual(second.message, { sequence: 2 })
  assert.strictEqual((await iterator.next()).done, true)
})

test('preserves Bithumb trade ids beyond the JavaScript safe integer range during replay', async () => {
  const bithumbTradeLine = (sequentialId: string, streamType: 'SNAPSHOT' | 'REALTIME', millisecond: number) =>
    `2026-09-22T00:00:00.000000${millisecond}Z {"type":"trade","code":"KRW-BTC","trade_price":116281000,"trade_volume":0.0012,"ask_bid":"BID","trade_timestamp":179003520000${millisecond},"sequential_id":${sequentialId},"timestamp":179003520000${millisecond},"stream_type":"${streamType}"}`

  // Keep the fixture values as strings until interpolation so JavaScript cannot round the unquoted JSON numbers first.
  const snapshotId = '1077860633149466017'
  const realtimeId = '1077860633149466018'
  const replayRange = { from: '2026-09-22T00:00:00.000Z', to: '2026-09-22T00:01:00.000Z' }
  feed = `${bithumbTradeLine(snapshotId, 'SNAPSHOT', 0)}\n${bithumbTradeLine(realtimeId, 'REALTIME', 1)}\n`

  const rawIds = []
  for await (const { message } of replay({
    exchange: 'bithumb',
    filters: [{ channel: 'trade', symbols: ['KRW-BTC'] }],
    ...replayRange
  })) {
    rawIds.push(message.sequential_id)
  }

  assert.deepStrictEqual(rawIds, [snapshotId, realtimeId])

  const normalizedIds = []
  for await (const message of replayNormalized({ exchange: 'bithumb', symbols: ['KRW-BTC'], ...replayRange }, normalizeTrades)) {
    normalizedIds.push(message.id)
  }

  assert.deepStrictEqual(normalizedIds, [realtimeId])
})

test('preserves recorded Bitvavo nanoseconds in raw and normalized replay', async () => {
  feed =
    '2026-09-23T00:00:08.0741562Z {"event":"trade","id":"00000000-0000-0431-0000-0000037d31c0","amount":"0.01158052","price":"75278","timestamp":1790121608063,"market":"BTC-EUR","side":"sell","timestampNs":1790121608063273941}\n'
  const options = { exchange: 'bitvavo' as const, from: '2026-09-23T00:00:00Z', to: '2026-09-23T00:01:00Z' }
  const messages = []
  for await (const { message } of replay({ ...options, filters: [{ channel: 'trade', symbols: ['BTC-EUR'] }] })) {
    messages.push(message)
  }
  assert.strictEqual(messages.length, 1)
  assert.strictEqual(messages[0].timestamp, 1790121608063)
  assert.strictEqual(messages[0].timestampNs, '1790121608063273941')

  const trades = []
  for await (const trade of replayNormalized({ ...options, symbols: ['BTC-EUR'] }, normalizeTrades)) {
    trades.push(trade)
  }
  assert.strictEqual(trades.length, 1)
  assert.strictEqual(trades[0].timestamp.toISOString(), '2026-09-23T00:00:08.063Z')
  assert.strictEqual(trades[0].timestamp.μs, 273)
  assert.strictEqual(trades[0].localTimestamp.μs, 156)
})

// Same payloads as the existing exchange mapper fixtures, kept as raw JSON here.
for (const fixture of [
  {
    exchange: 'huobi-dm-linear-swap' as const,
    symbol: 'EOS-USDT',
    json: '{"ch":"market.EOS-USDT.trade.detail","ts":1606780814945,"tick":{"id":291891365,"ts":1606780814931,"data":[{"amount":6,"ts":1606780814931,"id":2918913650000,"price":3.2639,"direction":"buy"}]}}',
    id: '2918913650000'
  },
  {
    exchange: 'upbit' as const,
    symbol: 'KRW-DOGE',
    json: '{"type":"trade","code":"KRW-DOGE","timestamp":1614729599905,"trade_date":"2021-03-02","trade_time":"23:59:59","trade_timestamp":1614729599000,"trade_price":58.4,"trade_volume":836.12040133,"ask_bid":"ASK","prev_closing_price":57.5,"change":"RISE","change_price":0.9,"sequential_id":1614729599000000,"stream_type":"REALTIME"}',
    id: '1614729599000000'
  }
]) {
  test(`preserves the same ${fixture.exchange} trade IDs in replay and live transport`, { timeout: 10_000 }, async () => {
    const { exchange, symbol, json, id } = fixture
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address !== null && typeof address === 'object')
    server.on('connection', (socket) => {
      socket.once('message', () => socket.send(exchange === 'upbit' ? json : gzipSync(json)))
    })
    const urlKey = `WSS_URL_${exchange.toUpperCase().replace(/-/g, '_')}`
    const previousURL = process.env[urlKey]
    process.env[urlKey] = `ws://127.0.0.1:${address.port}`
    const filters = [{ channel: 'trade' as const, symbols: [symbol] }]
    const live = stream({ exchange, filters })
    try {
      feed = `2026-09-23T00:00:00.0000000Z ${json}\n`
      const options = { exchange, filters, from: '2026-09-23T00:00:00Z', to: '2026-09-23T00:01:00Z' }
      const replayed = []
      for await (const entry of replay(options)) replayed.push(entry.message)
      assert.strictEqual(replayed.length, 1)
      const streamed = (await live.next()).value.message
      assert.deepStrictEqual(streamed, replayed[0])
      assert.strictEqual(exchange === 'upbit' ? streamed.sequential_id : streamed.tick.data[0].id, id)
      const localTimestamp = new Date()
      const [trade] = normalizeTrades(exchange, localTimestamp).map(streamed, localTimestamp)!
      assert.strictEqual(trade.id, id)
      for await (const entry of replay({ ...options, skipDecoding: true })) {
        assert.strictEqual(entry.message.toString(), json)
      }
    } finally {
      await live.return?.()
      if (previousURL === undefined) delete process.env[urlKey]
      else process.env[urlKey] = previousURL
      for (const socket of server.clients) socket.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}

test('parses fixed recorder timestamps across supported date boundaries', async () => {
  feed = [
    timestampedLine('2000-02-29T23:59:59.9990000Z', 1),
    timestampedLine('2099-12-31T23:59:59.0009999Z', 2),
    timestampedLine('2100-03-01T00:00:00.0012345Z', 3)
  ].join('\n')
  feed += '\n'

  const timestamps = []
  for await (const replayMessage of replay(rawOptions({ withMicroseconds: true }))) {
    assert.ok(replayMessage !== undefined)
    const { localTimestamp } = replayMessage
    timestamps.push({ iso: localTimestamp.toISOString(), μs: localTimestamp.μs })
  }

  assert.deepStrictEqual(timestamps, [
    { iso: '2000-02-29T23:59:59.999Z', μs: 0 },
    { iso: '2099-12-31T23:59:59.000Z', μs: 999 },
    { iso: '2100-03-01T00:00:00.001Z', μs: 234 }
  ])
})

test('does not silently skip malformed raw replay data', async () => {
  feed = `${line(1)}\n2026-07-01T00:00:00.0000001Z {invalid\n`

  await assert.rejects(replay(rawOptions()).next(), SyntaxError)
})

test('surfaces a data-slice failure to the replay consumer', async () => {
  workerError = new Error('HttpError: unavailable')

  await assert.rejects(replay(rawOptions()).next(), errorMessageIncludes('HttpError: unavailable'))
})

function normalizedOptions(withDisconnectMessages = false) {
  return {
    exchange: 'binance' as const,
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-01T00:01:00.000Z',
    withDisconnectMessages
  }
}

function rawOptions(options: { withDisconnects?: boolean; withMicroseconds?: boolean } = {}) {
  return {
    exchange: 'binance' as const,
    filters: [{ channel: 'trade' as const }],
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-01T00:01:00.000Z',
    ...options
  }
}

function line(sequence: number, time = '00.0000000') {
  return `2026-07-01T00:00:${time}Z ${JSON.stringify({ sequence })}`
}

function timestampedLine(localTimestamp: string, sequence: number) {
  return `${localTimestamp} ${JSON.stringify({ sequence })}`
}

function normalizer(name: string) {
  return ((exchange: string) => ({
    canHandle: () => true,
    getFilters: () => [{ channel: 'trade' }],
    *map(message: { sequence: number }, localTimestamp: Date) {
      yield normalizedMessage(exchange, `${name}-${message.sequence}`, localTimestamp)
    }
  })) as any
}

function resetAwareNormalizer(name: string, instances: Map<string, number>) {
  return ((exchange: string) => {
    const instance = (instances.get(name) ?? 0) + 1
    instances.set(name, instance)

    return {
      canHandle: () => true,
      getFilters: () => [{ channel: 'trade' }],
      *map(message: { sequence: number }, localTimestamp: Date) {
        yield normalizedMessage(exchange, `${name}-${instance}-${message.sequence}`, localTimestamp)
      }
    }
  }) as any
}

function throwingNormalizer(calls: string[]) {
  return ((exchange: string) => ({
    canHandle: () => true,
    getFilters: () => [{ channel: 'trade' }],
    *map(message: { sequence: number }, localTimestamp: Date) {
      calls.push(`map:throwing:${message.sequence}`)
      if (message.sequence === 2) {
        throw new Error('mapper failed on 2')
      }
      yield normalizedMessage(exchange, `throwing-${message.sequence}`, localTimestamp)
    }
  })) as any
}

function closableNormalizer(calls: string[]) {
  return ((exchange: string) => ({
    canHandle: () => true,
    getFilters: () => [{ channel: 'trade' }],
    *map(_message: { sequence: number }, localTimestamp: Date) {
      calls.push('map:closable:1')
      try {
        yield normalizedMessage(exchange, 'closable-1', localTimestamp)
      } finally {
        calls.push('close:closable')
      }
    }
  })) as any
}

function normalizedMessage(exchange: string, id: string, localTimestamp: Date) {
  return {
    type: 'trade',
    symbol: 'BTCUSDT',
    exchange,
    id,
    price: 1,
    amount: 1,
    side: 'buy',
    timestamp: localTimestamp,
    localTimestamp
  }
}
