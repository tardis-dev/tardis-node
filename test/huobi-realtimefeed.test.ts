import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { stream, SequenceGapError } from '../dist/index.js'
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

for (const validateSequence of [true, false]) {
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
        assert.strictEqual(errors[0].key, gap.ch)
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
