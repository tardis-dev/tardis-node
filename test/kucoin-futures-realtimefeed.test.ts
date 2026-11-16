import { test } from 'node:test'
import { stream, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

function update(sequence: number, symbol = 'XBTUSDTM') {
  return {
    type: 'message',
    topic: `/contractMarket/level2:${symbol}`,
    subject: 'level2',
    sn: sequence,
    data: { sequence, change: `100,buy,${sequence}`, timestamp: Date.now() }
  }
}
function snapshot(sequence: number) {
  return {
    type: 'message',
    generated: true,
    topic: '/contractMarket/level2Snapshot:XBTUSDTM',
    subject: 'level2Snapshot',
    code: '200000',
    data: { sequence, symbol: 'XBTUSDTM', bids: [[100, sequence]], asks: [], ts: Date.now() * 1000000 }
  }
}

for (const validateSequence of [true, false]) {
  test(
    `KuCoin Futures continuity and topic isolation: validation=${validateSequence ?? 'default'}`,
    { timeout: 10000 },
    async (context) => {
      const errors: Error[] = []
      const { server, wssURL, cleanup } = await createTestWebSocketServer()
      context.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
        assert.strictEqual(String(url), 'https://api-futures.kucoin.com/api/v1/bullet-public')
        assert.strictEqual(options?.method, 'POST')
        return Response.json({ data: { token: 'test', instanceServers: [{ endpoint: wssURL }] } })
      })
      const zeroPrice = update(102)
      zeroPrice.data.change = '0,buy,0'
      zeroPrice.sn = 999999 // Use data.sequence, not the envelope counter.
      const valid = [
        { type: 'welcome', id: 'test' },
        { type: 'ack', id: 'test' },
        { type: 'pong', id: 'test' },
        update(100),
        update(101),
        update(101),
        update(500, 'ETHUSDTM'),
        snapshot(50),
        { type: 'message', subject: 'match', topic: '/contractMarket/execution:XBTUSDTM', data: { sequence: 999999 } },
        { type: 'message', subject: 'tickerV2', topic: '/contractMarket/tickerV2:XBTUSDTM', data: { sequence: 999999 } },
        { type: 'message', subject: 'contractDetails', topic: '/contract/details:XBTUSDTM', data: { sequence: 999999 } },
        zeroPrice, // Price/size filtering must not skip continuity checks.
        update(501, 'ETHUSDTM')
      ]
      const gap = update(104)
      server.on('connection', (socket) =>
        socket.once('message', (bytes) => {
          const subscription = JSON.parse(bytes.toString())
          assert.strictEqual(subscription.topic, '/contractMarket/level2:ETHUSDTM,XBTUSDTM')
          for (const message of [...valid, gap]) socket.send(JSON.stringify(message))
        })
      )
      const feed = stream({
        exchange: 'kucoin-futures',
        filters: [{ channel: 'contractMarket/level2', symbols: ['XBTUSDTM', 'ETHUSDTM'] }],
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
          assert.strictEqual(errors[0].exchange, 'kucoin-futures')
          assert.strictEqual(errors[0].key, 'XBTUSDTM')
          assert.strictEqual(errors[0].expectedPreviousSequence, 102)
          assert.strictEqual(errors[0].previousSequence, 103)
          assert.strictEqual(errors[0].sequence, 104)
        }
      } finally {
        await feed.return?.()
        await cleanup()
      }
    }
  )
}
