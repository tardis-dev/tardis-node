import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { stream, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

const exchanges = ['huobi-dm', 'huobi-dm-swap', 'huobi-dm-linear-swap'] as const
function book(version: number, event = 'update', symbol = 'BTC-USD', empty = false) {
  return {
    ch: `market.${symbol}.depth.size_150.high_freq`,
    ts: 1793966400000,
    tick: { version, event, bids: empty ? [] : [[100, version + 1]], asks: [] }
  }
}
function send(socket: { send(data: Buffer): void }, messages: unknown[]) {
  for (const message of messages) socket.send(gzipSync(JSON.stringify(message)))
}

for (const exchange of exchanges) {
  const symbol = exchange === 'huobi-dm' ? 'BTC_CQ' : exchange === 'huobi-dm-swap' ? 'BTC-USD' : 'BTC-USDT'
  const other = symbol.replace('BTC', 'ETH')
  for (const validateSequence of [true, false]) {
    test(
      `${exchange} native continuity, resets and isolation: validation=${validateSequence ?? 'default'}`,
      { timeout: 10000 },
      async () => {
        const valid = [
          { status: 'ok', subbed: `market.${symbol}.depth.size_150.high_freq` },
          book(100, 'update', symbol), // The first message can establish the baseline.
          book(101, 'update', symbol, true), // Even an empty delta advances the chain.
          book(101, 'update', symbol, true),
          book(500, 'snapshot', other),
          { ch: `market.${symbol}.bbo`, tick: { version: 999999 } },
          { ch: `market.${symbol}.depth.step0`, tick: { version: 999999, event: 'snapshot' } },
          book(102, 'update', symbol),
          book(0, 'snapshot', symbol),
          book(1, 'update', symbol),
          book(501, 'update', other)
        ]
        const gap = book(3, 'update', symbol),
          errors: Error[] = []
        const { server, cleanup } = await createTestWebSocketServer(exchange)
        server.on('connection', (socket) =>
          socket.once('message', (data) => {
            const subscription = JSON.parse(data.toString())
            assert.strictEqual(subscription.sub, `market.${symbol}.depth.size_150.high_freq`)
            assert.strictEqual(subscription.data_type, 'incremental')
            send(socket, [...valid, gap])
          })
        )
        const feed = stream({
          exchange,
          filters: [{ channel: 'depth', symbols: [symbol, other] }],
          timeoutIntervalMS: 0,
          validateSequence,
          withDisconnects: true,
          onError: (error) => errors.push(error)
        })
        try {
          for (const message of valid) assert.deepStrictEqual((await feed.next()).value?.message, message)
          const next = (await feed.next()).value
          if (validateSequence === false) {
            assert.deepStrictEqual(next?.message, gap)
            assert.deepStrictEqual(errors, [])
          } else {
            assert.strictEqual(next, undefined)
            assert.strictEqual(errors.length, 1)
            assert.ok(errors[0] instanceof SequenceGapError)
            assert.strictEqual(errors[0].exchange, exchange)
            assert.strictEqual(errors[0].key, symbol)
            assert.strictEqual(errors[0].expectedPreviousSequence, 1)
            assert.strictEqual(errors[0].previousSequence, 2)
            assert.strictEqual(errors[0].sequence, 3)
          }
        } finally {
          await feed.return?.()
          await cleanup()
        }
      }
    )
  }
}
