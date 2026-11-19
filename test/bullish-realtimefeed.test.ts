import { test } from 'node:test'
import { normalizeBookChanges, OrderBook, stream, streamNormalized } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

for (const normalized of [false, true]) {
  test(`Bullish independent L2 snapshots continue across skipped ranges: normalized=${normalized}`, { timeout: 10000 }, async () => {
    const snapshot = (first: number, last: number, price: string) => ({
      type: 'snapshot',
      dataType: 'V1TALevel2',
      data: {
        symbol: 'BTCUSDC',
        sequenceNumberRange: [first, last],
        bids: [price, '1'],
        asks: [],
        timestamp: '1793786400000',
        publishedAtTimestamp: '1793786400000',
        datetime: '2026-11-04T10:00:00.000Z'
      }
    })
    const snapshots = [snapshot(100, 100, '100'), snapshot(112, 120, '99'), snapshot(112, 120, '99'), snapshot(500, 505, '98')]
    const errors: Error[] = []
    let connections = 0
    const { server, cleanup } = await createTestWebSocketServer('bullish')
    server.on('connection', (socket, request) => {
      connections++
      assert.strictEqual(request.url, '/trading-api/v1/market-data/orderbook')
      socket.on('message', (bytes) => {
        const subscription = JSON.parse(bytes.toString())
        assert.strictEqual(subscription.method, 'subscribe')
        assert.deepStrictEqual(subscription.params, { topic: 'l2Orderbook', symbol: 'BTCUSDC' })
        for (const message of [{ jsonrpc: '2.0', id: subscription.id, result: { message: 'Subscribed' } }, ...snapshots]) {
          socket.send(JSON.stringify(message))
        }
      })
    })
    const options = {
      exchange: 'bullish' as const,
      timeoutIntervalMS: 0,
      onError: (error: Error) => errors.push(error)
    }
    const messages = normalized
      ? streamNormalized({ ...options, symbols: ['BTCUSDC'], withDisconnectMessages: true }, normalizeBookChanges)
      : stream({ ...options, filters: [{ channel: 'V1TALevel2', symbols: ['BTCUSDC'] }], withDisconnects: true })
    try {
      if (!normalized) await messages.next() // Subscription acknowledgement.
      const book = new OrderBook()
      for (const snapshot of snapshots) {
        const next = (await messages.next()).value
        if (normalized) {
          assert.strictEqual(next.type, 'book_change')
          assert.strictEqual(next.isSnapshot, true)
          assert.deepStrictEqual(next.bids, [{ price: Number(snapshot.data.bids[0]), amount: 1 }])
          book.update(next)
          assert.deepStrictEqual([...book.bids()], next.bids)
        } else {
          assert.deepStrictEqual(next?.message, snapshot)
        }
      }
      assert.deepStrictEqual(errors, [])
      assert.strictEqual(connections, 1)
    } finally {
      try {
        await messages.return?.()
      } finally {
        await cleanup()
      }
    }
  })
}
