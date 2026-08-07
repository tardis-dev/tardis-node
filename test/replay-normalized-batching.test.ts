import { afterEach, mock, test } from 'node:test'
import { EventEmitter } from 'node:events'
import { assert, errorMessageIncludes } from './assertions.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

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

const { replay, replayNormalized } = await import('../dist/index.js')

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
