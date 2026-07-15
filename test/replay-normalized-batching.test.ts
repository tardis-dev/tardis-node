import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { jest } from '@jest/globals'

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

jest.unstable_mockModule('worker_threads', () => ({
  Worker: MockWorker,
  isMainThread: true,
  parentPort: undefined,
  workerData: undefined
}))

const { replay, replayNormalized } = await import('../dist/index.js')

afterEach(() => {
  feed = ''
  workerError = undefined
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { force: true, recursive: true })
  }
})

test('keeps mapper ordering, lazy invocation, disconnect resets, and public output shape', async () => {
  feed = [line(1), line(2), '', '', line(3, '30.1234567')].join('\n') + '\n'

  const calls: string[] = []
  const createdAt: string[] = []
  const iterator = replayNormalized(normalizedOptions(true), normalizer('first', calls, createdAt), normalizer('second', calls, createdAt))

  expect((await iterator.next()).value.id).toBe('first-1')
  expect(calls).toEqual(['create:first', 'create:second', 'map:first:1'])
  expect(createdAt).toEqual(['first:2026-07-01T00:00:00.000Z', 'second:2026-07-01T00:00:00.000Z'])

  expect((await iterator.next()).value.id).toBe('second-1')
  expect(calls).toEqual(['create:first', 'create:second', 'map:first:1', 'map:second:1'])

  expect((await iterator.next()).value.id).toBe('first-2')
  expect((await iterator.next()).value.id).toBe('second-2')
  expect((await iterator.next()).value).toMatchObject({ type: 'disconnect', exchange: 'binance', symbols: undefined })

  expect((await iterator.next()).value.id).toBe('first-3')
  expect(calls.slice(-3)).toEqual(['create:first', 'create:second', 'map:first:3'])
  expect(createdAt).toEqual([
    'first:2026-07-01T00:00:00.000Z',
    'second:2026-07-01T00:00:00.000Z',
    'first:2026-07-01T00:00:30.123456Z',
    'second:2026-07-01T00:00:30.123456Z'
  ])
  expect((await iterator.next()).value.id).toBe('second-3')
  expect((await iterator.next()).done).toBe(true)
})

test('does not invoke later mappers or process later raw messages after cancellation', async () => {
  feed = `${line(1)}\n${line(2)}\n`
  const calls: string[] = []
  const iterator = replayNormalized(normalizedOptions(), normalizer('first', calls), normalizer('second', calls))

  expect((await iterator.next()).value.id).toBe('first-1')
  await iterator.return?.()

  expect(calls).toEqual(['create:first', 'create:second', 'map:first:1'])
})

test('closes the active custom mapper iterator after cancellation', async () => {
  feed = `${line(1)}\n`
  const calls: string[] = []
  const iterator = replayNormalized(normalizedOptions(), closableNormalizer(calls))

  expect((await iterator.next()).value.id).toBe('closable-1')
  await iterator.return?.()

  expect(calls).toEqual(['map:closable:1', 'close:closable'])
})

test.each([null, false, 0])('keeps ignoring legacy falsy custom mapper output: %p', async (mappedValue) => {
  feed = `${line(1)}\n`
  const iterator = replayNormalized(normalizedOptions(), falsyNormalizer(mappedValue))

  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
})

test('yields earlier messages before surfacing a later mapper error', async () => {
  feed = `${line(1)}\n${line(2)}\n`
  const calls: string[] = []
  const iterator = replayNormalized(normalizedOptions(), throwingNormalizer(calls))

  expect((await iterator.next()).value.id).toBe('throwing-1')
  await expect(iterator.next()).rejects.toThrow('mapper failed on 2')
  expect(calls).toEqual(['map:throwing:1', 'map:throwing:2'])
})

test('yields earlier normalized messages before surfacing a later JSON error', async () => {
  feed = `${line(1)}\n2026-07-01T00:00:00.0000001Z {invalid\n`
  const iterator = replayNormalized(normalizedOptions(), normalizer('first', []))

  expect((await iterator.next()).value.id).toBe('first-1')
  await expect(iterator.next()).rejects.toThrow(SyntaxError)
})

test('keeps raw replay batch preparation and collapsed disconnect behavior', async () => {
  feed = [line(1, '00.0000010'), '', '', line(2, '00.0000020')].join('\n') + '\n'
  const iterator = replay(rawOptions({ withDisconnects: true, withMicroseconds: true }))

  const first = (await iterator.next()).value
  expect(first.message).toEqual({ sequence: 1 })
  expect(first.localTimestamp.μs).toBe(1)
  expect((await iterator.next()).value).toBeUndefined()
  expect((await iterator.next()).value.message).toEqual({ sequence: 2 })
  expect((await iterator.next()).done).toBe(true)
})

test('keeps raw replay no-catch behavior for malformed JSON in a prepared batch', async () => {
  feed = `${line(1)}\n2026-07-01T00:00:00.0000001Z {invalid\n`

  await expect(replay(rawOptions()).next()).rejects.toThrow(SyntaxError)
})

test('surfaces a worker error while waiting for a cache slice', async () => {
  workerError = new Error('HttpError: unavailable')

  await expect(replay(rawOptions()).next()).rejects.toThrow('HttpError: unavailable')
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

function normalizer(name: string, calls: string[], createdAt?: string[]) {
  return ((exchange: string, localTimestamp: Date) => {
    calls.push(`create:${name}`)
    createdAt?.push(`${name}:${localTimestamp.toISOString()}`)
    return {
      canHandle: () => true,
      getFilters: () => [{ channel: 'trade' }],
      *map(message: { sequence: number }, localTimestamp: Date) {
        calls.push(`map:${name}:${message.sequence}`)
        yield normalizedMessage(exchange, `${name}-${message.sequence}`, localTimestamp)
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

function falsyNormalizer(mappedValue: null | false | 0) {
  return (() => ({
    canHandle: () => true,
    getFilters: () => [{ channel: 'trade' }],
    map: () => mappedValue
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
