import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { type Writable } from 'node:stream'
import { type WebSocket, WebSocketServer } from 'ws'
import { assert } from './assertions.ts'
import { combine, compute, normalizeLiquidations, normalizeTrades, streamNormalized } from '../dist/index.js'
import { MultiConnectionRealTimeFeedBase, PoolingClientBase, RealTimeFeedBase } from '../dist/realtimefeeds/realtimefeed.js'
import { createManagedRealTimeIterator, type ManagedRealTimeIterator } from '../dist/realtimeiterator.js'
import { HttpClientError } from '../dist/handy.js'

test('return and async disposal are idempotent and prevent a source from starting', async () => {
  let starts = 0
  let closes = 0
  const source = (async function* () {
    starts++
    yield 'message'
  })()
  const iterator = createManagedRealTimeIterator(source, () => closes++)

  const closed = iterator.return()
  const returned = iterator.return()

  assert.strictEqual(returned, closed)
  assert.deepStrictEqual(await withTimeout(closed), { done: true, value: undefined })
  await withTimeout(iterator[Symbol.asyncDispose]())
  assert.deepStrictEqual(await withTimeout(iterator.next()), { done: true, value: undefined })
  assert.strictEqual(starts, 0)
  assert.strictEqual(closes, 1)
})

test('closes silent combined feeds when return is called during a pending read', async () => {
  const first = new ControlledFeed()
  const second = new ControlledFeed()
  const combined = new TestMultiConnectionFeed([first, second])
  const iterator = combined[Symbol.asyncIterator]()
  const pendingRead = iterator.next()

  await sleep(0)
  const returned = iterator.return()

  const [readResult, returnResult] = await withTimeout(Promise.all([pendingRead, returned]))
  assert.deepStrictEqual(readResult, { done: true, value: undefined })
  assert.deepStrictEqual(returnResult, { done: true, value: undefined })
  assert.strictEqual(first.closeCalls, 1)
  assert.strictEqual(second.closeCalls, 1)
})

test('closes sibling feeds when a combined source fails', async () => {
  const expectedError = new Error('source failed')
  const failing = createManagedRealTimeIterator(
    (async function* () {
      throw expectedError
    })(),
    () => {}
  )
  const siblingFeed = new ControlledFeed<{ localTimestamp: Date }>()
  const sibling = createManagedRealTimeIterator(siblingFeed, () => siblingFeed.close())
  const messages = combine(failing, sibling)

  const failed = assert.rejects(messages.next(), (error) => error === expectedError)
  await waitFor(() => siblingFeed.closeCalls === 1)
  await withTimeout(failed)
})

test('stops polling when a combined feed consumer stops', async () => {
  const pollingFeed = new ControlledPollingFeed()
  const combined = new TestMultiConnectionFeed([pollingFeed])
  const iterator = combined[Symbol.asyncIterator]()

  assert.strictEqual((await withTimeout(iterator.next())).value, 'message')
  await withTimeout(iterator.return())
  await sleep(30)

  assert.strictEqual(pollingFeed.polls, 1)
})

test('does not lose messages when a combined consumer applies backpressure', async () => {
  const messagesPerSource = 10_000
  const streams = ['first', 'second'].map((source) => {
    const iterator = (async function* () {
      for (let sequence = 0; sequence < messagesPerSource; sequence++) {
        yield { source, sequence, localTimestamp: new Date(sequence) }
      }
    })()
    return createManagedRealTimeIterator(iterator, () => {})
  })
  const nextSequence = new Map<string, number>([
    ['first', 0],
    ['second', 0]
  ])
  let received = 0

  await withTimeout(
    (async () => {
      for await (const message of combine(...streams)) {
        assert.strictEqual(message.sequence, nextSequence.get(message.source))
        nextSequence.set(message.source, message.sequence + 1)
        received++
        if (received % 100 === 0) {
          await sleep(0)
        }
      }
    })(),
    10_000
  )

  assert.strictEqual(received, messagesPerSource * streams.length)
})

test('compute and combine close both active and silent real-time WebSockets on break', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')

  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')

  const sockets = new Set<WebSocket>()
  let fastSocket: WebSocket | undefined
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString())
      if (message.method === 'public/subscribe' && message.params.channels.some((channel: string) => channel.includes('BTC-PERPETUAL'))) {
        fastSocket = socket
      }
    })
  })

  const previousURL = process.env.WSS_URL_DERIBIT
  process.env.WSS_URL_DERIBIT = `ws://127.0.0.1:${address.port}`

  const streams = [
    streamNormalized(
      {
        exchange: 'deribit',
        symbols: ['BTC-PERPETUAL']
      },
      normalizeTrades
    ),
    streamNormalized(
      {
        exchange: 'deribit',
        symbols: ['ETH-PERPETUAL']
      },
      normalizeLiquidations
    )
  ]
  const messages = compute(combine(...streams)) as ManagedRealTimeIterator<any>

  try {
    const consume = (async () => {
      for await (const message of messages) {
        assert.strictEqual(message.type, 'trade')
        assert.strictEqual(message.symbol, 'BTC-PERPETUAL')
        break
      }
    })()

    await waitFor(() => sockets.size === 2 && fastSocket !== undefined)
    fastSocket!.send(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'subscription',
        params: {
          channel: 'trades.BTC-PERPETUAL.100ms',
          data: [
            {
              instrument_name: 'BTC-PERPETUAL',
              trade_id: 'test',
              price: 1,
              amount: 1,
              direction: 'buy',
              timestamp: 0
            }
          ]
        }
      })
    )
    await withTimeout(consume)
    await waitFor(() => sockets.size === 0)
  } finally {
    try {
      await withTimeout(messages.return())
    } finally {
      if (previousURL === undefined) {
        delete process.env.WSS_URL_DERIBIT
      } else {
        process.env.WSS_URL_DERIBIT = previousURL
      }

      for (const socket of sockets) {
        socket.terminate()
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
})

test('does not let an old onConnected task subscribe on a reconnected socket', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')

  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')

  const sockets = new Set<WebSocket>()
  const connectedSockets: WebSocket[] = []
  const subscriptions = [0, 0]
  let connections = 0
  server.on('connection', (socket) => {
    const connectionIndex = connections
    sockets.add(socket)
    connectedSockets.push(socket)
    connections++
    socket.once('close', () => sockets.delete(socket))
    socket.on('message', (data) => {
      if (JSON.parse(data.toString()).type === 'subscribe') {
        subscriptions[connectionIndex]++
      }
    })
    socket.send(JSON.stringify({ connection: connections }))
  })

  let releaseFirstConnection!: () => void
  const firstConnection = new Promise<void>((resolve) => {
    releaseFirstConnection = resolve
  })
  let connectedCalls = 0
  let finishFirstConnection!: () => void
  const firstConnectionFinished = new Promise<void>((resolve) => {
    finishFirstConnection = resolve
  })
  const feed = new TestRealTimeFeed(`ws://127.0.0.1:${address.port}`, async () => {
    connectedCalls++
    if (connectedCalls === 1) {
      await firstConnection
      finishFirstConnection()
    }
  })

  const iterator = feed[Symbol.asyncIterator]()
  try {
    assert.deepStrictEqual((await withTimeout(iterator.next())).value, { connection: 1 })
    await waitFor(() => connectedCalls === 1)

    connectedSockets[0].close()
    assert.deepStrictEqual((await withTimeout(iterator.next())).value, { __disconnect__: true })
    assert.deepStrictEqual((await withTimeout(iterator.next())).value, { connection: 2 })
    await waitFor(() => subscriptions[1] === 1)
    assert.deepStrictEqual(subscriptions, [0, 1])

    releaseFirstConnection()
    await firstConnectionFinished
    await sleep(0)
    assert.deepStrictEqual(subscriptions, [0, 1])

    await withTimeout(iterator.return())
    await waitFor(() => sockets.size === 0)
  } finally {
    releaseFirstConnection()
    try {
      await withTimeout(iterator.return())
    } finally {
      for (const socket of sockets) {
        socket.terminate()
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
})

test('discards a delayed manual snapshot from a disconnected socket', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')

  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')

  const sockets = new Set<WebSocket>()
  const connectedSockets: WebSocket[] = []
  let connections = 0
  server.on('connection', (socket) => {
    sockets.add(socket)
    connectedSockets.push(socket)
    connections++
    socket.once('close', () => sockets.delete(socket))
    socket.send(JSON.stringify({ connection: connections }))
  })

  const feed = new TestSnapshotRealTimeFeed(`ws://127.0.0.1:${address.port}`)
  const iterator = feed[Symbol.asyncIterator]()

  try {
    assert.deepStrictEqual((await withTimeout(iterator.next())).value, { connection: 1 })
    await waitFor(() => feed.snapshotCalls === 1, 2000)

    connectedSockets[0].close()
    assert.deepStrictEqual((await withTimeout(iterator.next())).value, { __disconnect__: true })
    assert.deepStrictEqual((await withTimeout(iterator.next())).value, { connection: 2 })

    feed.releaseFirstSnapshot()
    await waitFor(() => feed.firstSnapshotFinished)
    assert.strictEqual(feed.bufferedSnapshots, 0)

    await withTimeout(iterator.return())
    await waitFor(() => sockets.size === 0)
  } finally {
    feed.releaseFirstSnapshot()
    try {
      await withTimeout(iterator.return())
    } finally {
      for (const socket of sockets) {
        socket.terminate()
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
})

test('return does not wait for WebSocket URL discovery', async () => {
  let urlRequested!: () => void
  const requested = new Promise<void>((resolve) => {
    urlRequested = resolve
  })
  let releaseURL!: () => void
  const url = new Promise<string>((resolve) => {
    releaseURL = () => resolve('ws://127.0.0.1')
  })
  const feed = new DelayedURLRealTimeFeed(url, urlRequested)
  const iterator = feed[Symbol.asyncIterator]()
  const pendingMessage = iterator.next()

  await requested
  const returned = iterator.return()

  try {
    await withTimeout(returned, 500)
    assert.deepStrictEqual(await withTimeout(pendingMessage), { done: true, value: undefined })
  } finally {
    releaseURL()
  }
})

test('backs off after an HTTP 418 snapshot error and cancels the wait when closed', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')

  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')

  const sockets = new Set<WebSocket>()
  let connections = 0
  server.on('connection', (socket) => {
    sockets.add(socket)
    connections++
    const connection = connections
    const messages = setInterval(() => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ connection }))
      }
    }, 20)
    socket.once('close', () => {
      clearInterval(messages)
      sockets.delete(socket)
    })
    socket.send(JSON.stringify({ connection }))
  })

  const feed = new RateLimitedSnapshotRealTimeFeed(`ws://127.0.0.1:${address.port}`)
  const iterator = feed[Symbol.asyncIterator]()
  let pendingReconnect: PromiseLike<IteratorResult<any>> | undefined

  try {
    assert.deepStrictEqual((await withTimeout(iterator.next())).value, { connection: 1 })
    await waitFor(() => feed.snapshotCalls === 1, 2000)

    let message: IteratorResult<any>
    do {
      message = await withTimeout(iterator.next())
    } while (message.value?.__disconnect__ !== true)

    pendingReconnect = iterator.next()
    await sleep(1100)
    assert.strictEqual(connections, 1)

    await withTimeout(iterator.return(), 500)
    assert.deepStrictEqual(await withTimeout(pendingReconnect), { done: true, value: undefined })
  } finally {
    try {
      await withTimeout(iterator.return())
    } finally {
      for (const socket of sockets) {
        socket.terminate()
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
})

class TestMultiConnectionFeed extends MultiConnectionRealTimeFeedBase {
  private readonly feeds: Array<ControlledFeed | ControlledPollingFeed>

  constructor(feeds: Array<ControlledFeed | ControlledPollingFeed>) {
    super('test', [], undefined)
    this.feeds = feeds
  }

  protected *_getRealTimeFeeds() {
    yield* this.feeds
  }
}

class ControlledFeed<T = string> implements AsyncIterableIterator<T> {
  closeCalls = 0
  private first: T | undefined
  private closed = false
  private finishPendingRead: (() => void) | undefined

  constructor(first?: T) {
    this.first = first
  }

  [Symbol.asyncIterator](): ManagedRealTimeIterator<T> {
    return createManagedRealTimeIterator(this, () => this.close())
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.closed) {
      return { done: true, value: undefined }
    }

    if (this.first !== undefined) {
      const value = this.first
      this.first = undefined
      return { done: false, value }
    }

    await new Promise<void>((resolve) => {
      this.finishPendingRead = resolve
    })
    return { done: true, value: undefined }
  }

  close() {
    if (this.closed) {
      return
    }

    this.closed = true
    this.closeCalls++
    this.finishPendingRead?.()
  }
}

class ControlledPollingFeed extends PoolingClientBase {
  polls = 0

  constructor() {
    super('test', 0.01)
  }

  protected async poolDataToStream(outputStream: Writable) {
    this.polls++
    outputStream.write('message')
  }
}

class TestRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL: string
  private readonly beforeSubscriptions: () => Promise<void>

  constructor(wssURL: string, beforeSubscriptions: () => Promise<void>) {
    super('test', [], undefined)
    this.wssURL = wssURL
    this.beforeSubscriptions = beforeSubscriptions
  }

  protected mapToSubscribeMessages() {
    return [{ type: 'subscribe' }]
  }

  protected messageIsError() {
    return false
  }

  protected async onConnected() {
    await this.beforeSubscriptions()
  }
}

class DelayedURLRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = ''
  private readonly url: Promise<string>
  private readonly urlRequested: () => void

  constructor(url: Promise<string>, urlRequested: () => void) {
    super('test', [], undefined)
    this.url = url
    this.urlRequested = urlRequested
  }

  protected async getWebSocketUrl() {
    this.urlRequested()
    return this.url
  }

  protected mapToSubscribeMessages() {
    return []
  }

  protected messageIsError() {
    return false
  }
}

class TestSnapshotRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL: string
  snapshotCalls = 0
  firstSnapshotFinished = false
  private releaseSnapshot!: () => void
  private readonly snapshotRelease = new Promise<void>((resolve) => {
    this.releaseSnapshot = resolve
  })

  constructor(wssURL: string) {
    super('test', [], undefined)
    this.wssURL = wssURL
  }

  get bufferedSnapshots() {
    return this.manualSnapshotsBuffer.length
  }

  releaseFirstSnapshot() {
    this.releaseSnapshot()
  }

  protected mapToSubscribeMessages() {
    return []
  }

  protected messageIsError() {
    return false
  }

  protected async provideManualSnapshots(_filters: unknown[], shouldCancel: () => boolean) {
    this.snapshotCalls++
    if (this.snapshotCalls !== 1) {
      return
    }

    await this.snapshotRelease
    if (shouldCancel() === false) {
      this.manualSnapshotsBuffer.push({ oldSnapshot: true })
    }
    this.firstSnapshotFinished = true
  }
}

class RateLimitedSnapshotRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL: string
  snapshotCalls = 0

  constructor(wssURL: string) {
    super('test', [], undefined)
    this.wssURL = wssURL
  }

  protected mapToSubscribeMessages() {
    return []
  }

  protected messageIsError() {
    return false
  }

  protected async provideManualSnapshots() {
    this.snapshotCalls++
    throw new HttpClientError({ statusCode: 418, headers: {}, body: 'IP banned' }, 'GET', 'https://exchange.test/depth')
  }
}

async function waitFor(condition: () => boolean, timeoutMS = 1000) {
  const deadline = Date.now() + timeoutMS
  while (condition() === false) {
    if (Date.now() >= deadline) {
      assert.fail('Timed out waiting for condition')
    }
    await sleep(10)
  }
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMS = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMS}ms`)), timeoutMS)
    void Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}
