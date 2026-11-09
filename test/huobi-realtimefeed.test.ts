import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { stream, streamNormalized, normalizeBookChanges, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

const channel = (symbol = 'btcusdt') => `market.${symbol}.mbp.400`
function update(seqNum: number, prevSeqNum: number, symbol = 'btcusdt') {
  return { ch: channel(symbol), ts: Date.now(), tick: { seqNum, prevSeqNum, bids: [[100, seqNum]], asks: [] } }
}
function snapshot(seqNum: number, symbol = 'btcusdt') {
  return { rep: channel(symbol), ts: Date.now(), data: { seqNum, bids: [[100, seqNum]], asks: [[200, 1]] } }
}
function send(socket: { send(data: Buffer): void }, messages: unknown[]) {
  for (const message of messages) socket.send(gzipSync(JSON.stringify(message)))
}

for (const validateSequence of [undefined, true, false]) {
  test(`Huobi MBP continuity and ignored snapshots: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const native = [
      { status: 'ok', subbed: channel() },
      update(10, 5), // First update establishes the baseline without waiting for a snapshot.
      update(20, 10),
      update(20, 10), // Duplicates are accepted.
      snapshot(5), // Delayed snapshots must not rewind the live update chain.
      update(30, 20),
      update(100, 90, 'ethusdt'),
      { rep: channel(), data: null },
      { ch: 'market.btcusdt.bbo', tick: { seqNum: 999999, prevSeqNum: 999998 } },
      update(110, 100, 'ethusdt')
    ]
    const gap = update(50, 40)
    const errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('huobi')
    server.on('connection', (socket) => socket.once('message', () => send(socket, [...native, gap])))
    const feed = stream({
      exchange: 'huobi',
      filters: [{ channel: 'mbp', symbols: ['btcusdt', 'ethusdt'] }],
      timeoutIntervalMS: 0,
      validateSequence,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })
    try {
      for (const message of native) assert.deepStrictEqual((await feed.next()).value?.message, message)
      const next = (await feed.next()).value
      if (validateSequence === false) {
        assert.deepStrictEqual(next?.message, gap)
        assert.deepStrictEqual(errors, [])
      } else {
        assert.strictEqual(next, undefined)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
        assert.strictEqual(errors[0].key, 'btcusdt')
        assert.strictEqual(errors[0].expectedPreviousSequence, 30)
        assert.strictEqual(errors[0].previousSequence, 40)
        assert.strictEqual(errors[0].sequence, 50)
      }
    } finally {
      await feed.return?.()
      await cleanup()
    }
  })
}

for (const normalized of [false, true])
  for (const withDisconnects of [false, true]) {
    test(`Huobi sequence recovery: normalized=${normalized}, disconnects=${withDisconnects}`, { timeout: 10000 }, async () => {
      let connections = 0
      const errors: Error[] = [],
        { server, cleanup } = await createTestWebSocketServer('huobi')
      const initial = [snapshot(100), update(110, 100), update(130, 120)]
      const recovered = [snapshot(1), update(2, 1)]
      server.on('connection', (socket) => {
        const first = ++connections === 1
        socket.once('message', () => send(socket, first ? initial : recovered))
      })
      const options = { exchange: 'huobi' as const, timeoutIntervalMS: 0, onError: (error: Error) => errors.push(error) }
      const feed = normalized
        ? streamNormalized({ ...options, symbols: ['BTCUSDT'], withDisconnectMessages: withDisconnects }, normalizeBookChanges)
        : stream({ ...options, filters: [{ channel: 'mbp', symbols: ['btcusdt'] }], withDisconnects })
      const output: any[] = []
      try {
        for await (const message of feed) {
          output.push(message)
          if (output.length === (withDisconnects ? 5 : 4)) break
        }
        if (withDisconnects) {
          assert.strictEqual(normalized ? output[2].type : output[2], normalized ? 'disconnect' : undefined)
          output.splice(2, 1)
        }
        assert.strictEqual(connections, 2)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
        if (normalized) {
          assert.deepStrictEqual(
            output.map((message) => message.isSnapshot),
            [true, false, true, false]
          )
          assert.deepStrictEqual(
            output.map((message) => message.bids),
            [100, 110, 1, 2].map((amount) => [{ price: 100, amount }])
          )
        } else
          assert.deepStrictEqual(
            output.map((message) => message.message),
            [...initial.slice(0, 2), ...recovered]
          )
      } finally {
        await feed.return?.()
        await cleanup()
      }
    })
  }

test('Huobi normalized opt-out preserves existing mapping across a gap', { timeout: 10000 }, async () => {
  const errors: Error[] = []
  const { server, cleanup } = await createTestWebSocketServer('huobi')
  server.on('connection', (socket) => socket.once('message', () => send(socket, [snapshot(10), update(20, 10), update(40, 30)])))
  const feed = streamNormalized(
    { exchange: 'huobi', symbols: ['BTCUSDT'], timeoutIntervalMS: 0, validateSequence: false, onError: (error) => errors.push(error) },
    normalizeBookChanges
  )
  try {
    for (const amount of [10, 20, 40]) assert.deepStrictEqual((await feed.next()).value.bids, [{ price: 100, amount }])
    assert.deepStrictEqual(errors, [])
  } finally {
    await feed.return?.()
    await cleanup()
  }
})

test('Huobi derivatives migration leaves legacy options validation unchanged', { timeout: 10000 }, async () => {
  const native = [1, 50].map((version) => ({
    ch: 'market.BTC-USDT-210521-C-42000.depth.size_150.high_freq',
    ts: Date.now(),
    tick: { version, event: 'update', bids: [], asks: [] }
  }))
  const errors: Error[] = [],
    { server, cleanup } = await createTestWebSocketServer('huobi-dm-options')
  server.on('connection', (socket) => socket.once('message', () => send(socket, native)))
  const feed = stream({
    exchange: 'huobi-dm-options',
    filters: [{ channel: 'depth', symbols: ['BTC-USDT-210521-C-42000'] }],
    timeoutIntervalMS: 0,
    onError: (error) => errors.push(error)
  })
  try {
    for (const message of native) assert.deepStrictEqual((await feed.next()).value?.message, message)
    assert.deepStrictEqual(errors, [])
  } finally {
    await feed.return?.()
    await cleanup()
  }
})
