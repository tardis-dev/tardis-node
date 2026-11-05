import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { mock, test, type TestContext } from 'node:test'
import { WebSocketServer, type WebSocket } from 'ws'
import { assert } from './assertions.ts'
import * as feeds from '../dist/realtimefeeds/realtimefeed.js'
import type { SequenceInfo } from '../dist/realtimefeeds/realtimefeed.js'

const handledMessages: number[] = []

// Supply a test protocol to real feed classes without enabling an exchange adapter.
class SequencedRealTimeFeedBase extends feeds.RealTimeFeedBase {
  protected wssURL = 'ws://unused'
  protected mapToSubscribeMessages() {
    return [{ subscribe: true }]
  }
  protected messageIsError() {
    return false
  }
  protected getSequence(message: { testSequence?: SequenceInfo }) {
    return message.testSequence
  }
  protected onMessage(message: { id: number }) {
    handledMessages.push(message.id)
  }
}

mock.module('../dist/realtimefeeds/realtimefeed.js', {
  exports: { ...feeds, RealTimeFeedBase: SequencedRealTimeFeedBase }
})

const { stream, streamNormalized, normalizeBookChanges, SequenceGapError } = await import('../dist/index.js')

function message(id: number, sequenceId?: number, previousSequenceId: number | null = null, key = 'book') {
  return { id, ...(sequenceId === undefined ? {} : { testSequence: { key, sequenceId, previousSequenceId } }) }
}

async function serverFor(t: TestContext, exchange: string, onSubscribe: (socket: WebSocket, connection: number) => void) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  const envKey = `WSS_URL_${exchange.toUpperCase().replaceAll('-', '_')}`
  const previousURL = process.env[envKey]
  process.env[envKey] = `ws://127.0.0.1:${address.port}`
  const sockets: WebSocket[] = []
  server.on('connection', (socket) => {
    sockets.push(socket)
    const connection = sockets.length
    socket.once('message', () => onSubscribe(socket, connection))
  })
  t.after(async () => {
    if (previousURL === undefined) delete process.env[envKey]
    else process.env[envKey] = previousURL
    for (const socket of sockets) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return sockets
}

function send(socket: WebSocket, ...messages: object[]) {
  for (const item of messages) socket.send(JSON.stringify(item))
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await sleep(10)
  }
  assert.fail('Condition did not become true')
}

test('raw validation accepts zero, duplicates, independent keys, unsequenced messages and native resets', { timeout: 10000 }, async (t) => {
  const errors: Error[] = []
  const items = [
    message(1, 0),
    message(2, 1, 0),
    message(3, 1, 99),
    message(4, 900, undefined, 'other'),
    message(5),
    message(6, 2, 1),
    message(7, 901, 900, 'other'),
    message(8, 500),
    message(9, 501, 500)
  ]
  await serverFor(t, 'bybit-spot', (socket) => send(socket, ...items, message(10, 503, 502), message(11, 504, 503)))
  const iterator = stream({
    exchange: 'bybit-spot',
    filters: [{ channel: 'publicTrade', symbols: ['BTCUSDT'] }],
    timeoutIntervalMS: 0,
    validateSequence: true,
    withDisconnects: true,
    onError: (error) => errors.push(error)
  })
  t.after(() => iterator.return?.())
  handledMessages.length = 0
  for (const item of items) assert.deepStrictEqual((await iterator.next()).value?.message, JSON.parse(JSON.stringify(item)))
  assert.strictEqual((await iterator.next()).value, undefined)
  assert.deepStrictEqual(
    handledMessages,
    items.map((item) => item.id)
  )
  assert.strictEqual(errors.length, 1)
  assert.ok(errors[0] instanceof SequenceGapError)
  assert.strictEqual(errors[0].name, 'SequenceGapError')
  assert.strictEqual(errors[0].exchange, 'bybit-spot')
  assert.strictEqual(errors[0].key, 'book')
  assert.strictEqual(errors[0].expectedPreviousSequence, 501)
  assert.strictEqual(errors[0].previousSequence, 502)
  assert.strictEqual(errors[0].sequence, 503)
  assert.strictEqual(errors[0].message, 'bybit-spot sequence gap on book: expected previous sequence 501, received 502 (sequence 503)')
})

test('explicit opt-out disables the shared sequence check', { timeout: 10000 }, async (t) => {
  const items = [message(1, 0), message(2, 2, 1)]
  await serverFor(t, 'bybit-spot', (socket) => send(socket, ...items))
  const iterator = stream({
    exchange: 'bybit-spot',
    filters: [{ channel: 'publicTrade', symbols: ['BTCUSDT'] }],
    timeoutIntervalMS: 0,
    validateSequence: false,
    onError: (error) => assert.fail(error.message)
  })
  t.after(() => iterator.return?.())
  for (const item of items) assert.deepStrictEqual((await iterator.next()).value.message, JSON.parse(JSON.stringify(item)))
})

for (const { withDisconnects, validateSequence } of [
  { withDisconnects: false, validateSequence: undefined },
  { withDisconnects: true, validateSequence: true }
]) {
  test(`raw gap reconnects with clean state (withDisconnects=${withDisconnects})`, { timeout: 10000 }, async (t) => {
    const errors: Error[] = []
    const sockets = await serverFor(t, 'bybit-spot', (socket, connection) => {
      if (connection === 1) send(socket, message(1, 50), message(2, 52, 51))
      else send(socket, message(3, 1, 0), message(4, 2, 1))
    })
    const iterator = stream({
      exchange: 'bybit-spot',
      filters: [{ channel: 'publicTrade', symbols: ['BTCUSDT'] }],
      timeoutIntervalMS: 0,
      validateSequence,
      withDisconnects,
      onError: (error) => errors.push(error)
    })
    t.after(() => iterator.return?.())
    assert.strictEqual((await iterator.next()).value?.message.id, 1)
    if (withDisconnects) assert.strictEqual((await iterator.next()).value, undefined)
    assert.strictEqual((await iterator.next()).value?.message.id, 3)
    assert.strictEqual((await iterator.next()).value?.message.id, 4)
    assert.strictEqual(errors.length, 1)
    assert.strictEqual(sockets.length, 2)
  })
}

for (const failedChild of [0, 1]) {
  test(
    `child ${failedChild} gap closes siblings and restarts the entire feed with connection-local counters`,
    { timeout: 10000 },
    async (t) => {
      const errors: Error[] = []
      const sockets = await serverFor(t, 'bybit', (socket, connection) => send(socket, message(connection, 0)))
      const iterator = stream({
        exchange: 'bybit',
        filters: [{ channel: 'publicTrade', symbols: ['BTCUSDT', 'BTCUSD'] }],
        timeoutIntervalMS: 0,
        validateSequence: true,
        withDisconnects: true,
        onError: (error) => errors.push(error)
      })
      t.after(() => iterator.return?.())
      const received = [(await iterator.next()).value?.message.id, (await iterator.next()).value?.message.id]
      assert.deepStrictEqual(received.sort(), [1, 2])
      send(sockets[failedChild], message(99, 2, 1))
      assert.strictEqual((await iterator.next()).value, undefined)
      await waitFor(() => sockets.slice(0, 2).every((socket) => socket.readyState === 3))
      const recovered = [(await iterator.next()).value?.message.id, (await iterator.next()).value?.message.id]
      assert.deepStrictEqual(recovered.sort(), [3, 4])
      assert.strictEqual(errors.length, 1)
    }
  )
}

function book(id: number, type: 'snapshot' | 'delta', sequence: number, previousSequence?: number) {
  return {
    ...message(id, sequence, previousSequence),
    topic: 'orderbook.50.BTCUSDT',
    type,
    ts: 1793786400000,
    data: { s: 'BTCUSDT', b: [['100', '1']], a: [['101', '2']], u: sequence, seq: sequence }
  }
}

for (const withDisconnectMessages of [false, true]) {
  test(
    `normalized validation recovers fresh snapshots (withDisconnectMessages=${withDisconnectMessages})`,
    { timeout: 10000 },
    async (t) => {
      const errors: Error[] = []
      await serverFor(t, 'bybit-spot', (socket, connection) => {
        if (connection === 1) send(socket, book(1, 'snapshot', 10), book(2, 'delta', 11, 10), book(3, 'delta', 13, 12))
        else send(socket, book(4, 'snapshot', 1), book(5, 'delta', 2, 1))
      })
      const iterator = streamNormalized(
        {
          exchange: 'bybit-spot',
          symbols: ['BTCUSDT'],
          timeoutIntervalMS: 0,
          validateSequence: true,
          withDisconnectMessages,
          onError: (error) => errors.push(error)
        },
        normalizeBookChanges
      )
      t.after(() => iterator.return?.())
      assert.strictEqual((await iterator.next()).value.type, 'book_change')
      assert.strictEqual((await iterator.next()).value.type, 'book_change')
      if (withDisconnectMessages) assert.strictEqual((await iterator.next()).value.type, 'disconnect')
      const snapshot = (await iterator.next()).value
      assert.strictEqual(snapshot.type, 'book_change')
      assert.ok('isSnapshot' in snapshot && snapshot.isSnapshot)
      const update = (await iterator.next()).value
      assert.ok('isSnapshot' in update && !update.isSnapshot)
      assert.strictEqual(errors.length, 1)
      assert.ok(errors[0] instanceof SequenceGapError)
    }
  )
}

test('normalized opt-out passes discontinuous updates without a gap error', { timeout: 10000 }, async (t) => {
  await serverFor(t, 'bybit-spot', (socket) => send(socket, book(1, 'snapshot', 1), book(2, 'delta', 3, 2)))
  const iterator = streamNormalized(
    {
      exchange: 'bybit-spot',
      symbols: ['BTCUSDT'],
      timeoutIntervalMS: 0,
      validateSequence: false,
      onError: (error) => assert.fail(error.message)
    },
    normalizeBookChanges
  )
  t.after(() => iterator.return?.())
  assert.strictEqual((await iterator.next()).value.type, 'book_change')
  const update = (await iterator.next()).value
  assert.ok('isSnapshot' in update && !update.isSnapshot)
})

test('return cancels the retry after a sequence gap', { timeout: 10000 }, async (t) => {
  const sockets = await serverFor(t, 'bybit-spot', (socket) => send(socket, message(1, 0), message(2, 2, 1)))
  const iterator = stream({
    exchange: 'bybit-spot',
    filters: [{ channel: 'publicTrade', symbols: ['BTCUSDT'] }],
    timeoutIntervalMS: 0,
    validateSequence: true,
    withDisconnects: true
  })
  t.after(() => iterator.return?.())
  await iterator.next()
  assert.strictEqual((await iterator.next()).value, undefined)
  const pending = iterator.next()
  await sleep(10)
  await iterator.return?.()
  assert.deepStrictEqual(await pending, { done: true, value: undefined })
  assert.strictEqual(sockets.length, 1)
})
