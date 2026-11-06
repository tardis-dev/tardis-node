import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import type { WebSocket } from 'ws'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'
import {
  RealTimeFeedBase,
  MultiConnectionRealTimeFeedBase,
  SequenceGapError,
  type SequenceInfo
} from '../dist/realtimefeeds/realtimefeed.js'
import type { Filter } from '../dist/types.js'

class TestSequenceFeed extends RealTimeFeedBase {
  readonly handledMessages: number[] = []
  protected wssURL: string

  constructor(wssURL: string, validateSequence?: boolean, onError?: (error: Error) => void) {
    super('test', [], 0, validateSequence, onError)
    this.wssURL = wssURL
  }

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
    this.handledMessages.push(message.id)
  }
}

class TestMultiConnectionFeed extends MultiConnectionRealTimeFeedBase {
  private readonly wssURL: string

  constructor(wssURL: string, validateSequence?: boolean, onError?: (error: Error) => void) {
    super('test', [], 0, validateSequence, onError)
    this.wssURL = wssURL
  }

  protected *_getRealTimeFeeds(
    _exchange: string,
    _filters: Filter<string>[],
    _timeoutIntervalMS?: number,
    validateSequence?: boolean,
    onError?: (error: Error) => void
  ) {
    yield new TestSequenceFeed(this.wssURL, validateSequence, onError)
    yield new TestSequenceFeed(this.wssURL, validateSequence, onError)
  }
}

function message(id: number, sequenceId?: number, previousSequenceId: number | null = null, key = 'book') {
  return { id, ...(sequenceId === undefined ? {} : { testSequence: { key, sequenceId, previousSequenceId } }) }
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

test('validation accepts zero, duplicates, independent keys, unsequenced messages and native resets', { timeout: 10000 }, async () => {
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
  const { server, wssURL, cleanup } = await createTestWebSocketServer()
  server.on('connection', (socket) => {
    socket.once('message', () => send(socket, ...items, message(10, 503, 502), message(11, 504, 503)))
  })
  const feed = new TestSequenceFeed(wssURL, true, (error) => errors.push(error))
  const iterator = feed[Symbol.asyncIterator]()
  try {
    for (const item of items) assert.deepStrictEqual((await iterator.next()).value, JSON.parse(JSON.stringify(item)))
    const disconnect = (await iterator.next()).value
    assert.strictEqual(disconnect.__disconnect__, true)
    assert.strictEqual(disconnect.error, errors[0])
    assert.deepStrictEqual(
      feed.handledMessages,
      items.map((item) => item.id)
    )
    assert.strictEqual(errors.length, 1)
    assert.ok(errors[0] instanceof SequenceGapError)
    assert.strictEqual(errors[0].name, 'SequenceGapError')
    assert.strictEqual(errors[0].exchange, 'test')
    assert.strictEqual(errors[0].key, 'book')
    assert.strictEqual(errors[0].expectedPreviousSequence, 501)
    assert.strictEqual(errors[0].previousSequence, 502)
    assert.strictEqual(errors[0].sequence, 503)
    assert.strictEqual(errors[0].message, 'test sequence gap on book: expected previous sequence 501, received 502 (sequence 503)')
  } finally {
    try {
      await iterator.return?.()
    } finally {
      await cleanup()
    }
  }
})

test('explicit opt-out disables the shared sequence check', { timeout: 10000 }, async () => {
  const items = [message(1, 0), message(2, 2, 1)]
  const { server, wssURL, cleanup } = await createTestWebSocketServer()
  server.on('connection', (socket) => {
    socket.once('message', () => send(socket, ...items))
  })
  const feed = new TestSequenceFeed(wssURL, false, (error) => assert.fail(error.message))
  const iterator = feed[Symbol.asyncIterator]()
  try {
    for (const item of items) assert.deepStrictEqual((await iterator.next()).value, JSON.parse(JSON.stringify(item)))
  } finally {
    try {
      await iterator.return?.()
    } finally {
      await cleanup()
    }
  }
})

test('validation defaults on and reconnects with clean state after a gap', { timeout: 10000 }, async () => {
  const errors: Error[] = []
  let connections = 0
  const { server, wssURL, cleanup } = await createTestWebSocketServer()
  server.on('connection', (socket) => {
    const first = ++connections === 1
    socket.once('message', () => {
      if (first) send(socket, message(1, 50), message(2, 52, 51))
      else send(socket, message(3, 1, 0), message(4, 2, 1))
    })
  })
  const feed = new TestSequenceFeed(wssURL, undefined, (error) => errors.push(error))
  const iterator = feed[Symbol.asyncIterator]()
  try {
    assert.strictEqual((await iterator.next()).value.id, 1)
    assert.strictEqual((await iterator.next()).value.__disconnect__, true)
    assert.strictEqual((await iterator.next()).value.id, 3)
    assert.strictEqual((await iterator.next()).value.id, 4)
    assert.strictEqual(errors.length, 1)
    assert.strictEqual(connections, 2)
  } finally {
    try {
      await iterator.return?.()
    } finally {
      await cleanup()
    }
  }
})

for (const failedChild of [0, 1]) {
  test(`child ${failedChild} gap closes siblings and restarts with connection-local counters`, { timeout: 10000 }, async () => {
    const errors: Error[] = []
    const sockets: WebSocket[] = []
    const { server, wssURL, cleanup } = await createTestWebSocketServer()
    server.on('connection', (socket) => {
      sockets.push(socket)
      const connection = sockets.length
      socket.once('message', () => send(socket, message(connection, 0)))
    })
    const feed = new TestMultiConnectionFeed(wssURL, true, (error) => errors.push(error))
    const iterator = feed[Symbol.asyncIterator]()
    try {
      const received = [(await iterator.next()).value.id, (await iterator.next()).value.id]
      assert.deepStrictEqual(received.sort(), [1, 2])
      send(sockets[failedChild], message(99, 2, 1))
      assert.strictEqual((await iterator.next()).value.__disconnect__, true)
      await waitFor(() => sockets.slice(0, 2).every((socket) => socket.readyState === 3))
      const recovered = [(await iterator.next()).value.id, (await iterator.next()).value.id]
      assert.deepStrictEqual(recovered.sort(), [3, 4])
      assert.strictEqual(errors.length, 1)
      assert.ok(errors[0] instanceof SequenceGapError)
    } finally {
      try {
        await iterator.return?.()
      } finally {
        await cleanup()
      }
    }
  })
}

test('return cancels the retry after a sequence gap', { timeout: 10000 }, async () => {
  let connections = 0
  const { server, wssURL, cleanup } = await createTestWebSocketServer()
  server.on('connection', (socket) => {
    connections++
    socket.once('message', () => send(socket, message(1, 0), message(2, 2, 1)))
  })
  const feed = new TestSequenceFeed(wssURL)
  const iterator = feed[Symbol.asyncIterator]()
  try {
    await iterator.next()
    assert.strictEqual((await iterator.next()).value.__disconnect__, true)
    const pending = iterator.next()
    await sleep(10)
    await iterator.return?.()
    assert.deepStrictEqual(await pending, { done: true, value: undefined })
    assert.strictEqual(connections, 1)
  } finally {
    try {
      await iterator.return?.()
    } finally {
      await cleanup()
    }
  }
})
