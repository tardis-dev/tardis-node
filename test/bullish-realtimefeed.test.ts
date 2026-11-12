import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import type { WebSocket } from 'ws'
import { stream, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

for (const gapType of ['update', 'snapshot'] as const) {
  for (const validateSequence of [undefined, false]) {
    test(`Bullish ${gapType}: sequence validation ${validateSequence === false ? 'disabled' : 'default'}`, { timeout: 10000 }, async () => {
      const book = (first: number, last: number, type: 'snapshot' | 'update' = 'update') => ({
        type,
        dataType: 'V1TALevel2',
        data: {
          symbol: 'BTCUSDC',
          sequenceNumberRange: [first, last],
          bids: ['100', '1'],
          asks: [],
          timestamp: '1793786400000',
          publishedAtTimestamp: '1793786400000',
          datetime: '2026-11-04T10:00:00.000Z'
        }
      })
      const valid = [
        book(100, 100, 'snapshot'),
        book(101, 105),
        book(106, 110, 'snapshot'),
        book(106, 110, 'snapshot'),
        {
          type: 'update',
          dataType: 'V1TALevel1',
          data: { symbol: 'BTCUSDC', bid: ['100', '1'], ask: ['101', '1'], sequenceNumber: '900', timestamp: '1793786400000' }
        }
      ]
      const gap = book(112, 120, gapType)
      const errors: Error[] = []
      const { server, cleanup } = await createTestWebSocketServer('bullish')
      server.on('connection', (socket, request) => {
        assert.strictEqual(request.url, '/trading-api/v1/market-data/orderbook')
        socket.on('message', (bytes) => {
          const subscription = JSON.parse(bytes.toString())
          assert.strictEqual(subscription.method, 'subscribe')
          assert.deepStrictEqual(subscription.params, { topic: 'l2Orderbook', symbol: 'BTCUSDC' })
          for (const message of [{ jsonrpc: '2.0', id: subscription.id, result: { message: 'Subscribed' } }, ...valid, gap]) {
            socket.send(JSON.stringify(message))
          }
        })
      })
      const messages = stream({
        exchange: 'bullish',
        filters: [{ channel: 'V1TALevel2', symbols: ['BTCUSDC'] }],
        timeoutIntervalMS: 0,
        validateSequence,
        withDisconnects: true,
        onError: (error) => errors.push(error)
      })
      try {
        await messages.next() // Subscription acknowledgement.
        for (const message of valid) assert.deepStrictEqual((await messages.next()).value?.message, message)
        const next = (await messages.next()).value
        if (validateSequence === false) {
          assert.deepStrictEqual(next?.message, gap)
          assert.deepStrictEqual(errors, [])
        } else {
          assert.strictEqual(next, undefined)
          assert.strictEqual(errors.length, 1)
          assert.ok(errors[0] instanceof SequenceGapError)
          assert.strictEqual(errors[0].key, 'BTCUSDC')
          assert.strictEqual(errors[0].expectedPreviousSequence, 110)
          assert.strictEqual(errors[0].previousSequence, 111)
          assert.strictEqual(errors[0].sequence, 120)
        }
      } finally {
        try {
          await messages.return?.()
        } finally {
          await cleanup()
        }
      }
    })
  }
}

test('Bullish L2 gaps restart every market-data path and accept fresh sequence counters', { timeout: 10000 }, async () => {
  const book = (sequence: number, type: 'snapshot' | 'update' = 'snapshot') => ({
    type,
    dataType: 'V1TALevel2',
    data: {
      symbol: 'BTCUSDC',
      sequenceNumberRange: [sequence, sequence],
      bids: ['100', '1'],
      asks: [],
      timestamp: '1793786400000',
      publishedAtTimestamp: '1793786400000',
      datetime: '2026-11-04T10:00:00.000Z'
    }
  })
  const errors: Error[] = []
  const connections: { socket: WebSocket; path: string }[] = []
  const { server, cleanup } = await createTestWebSocketServer('bullish')
  server.on('connection', (socket, request) => {
    const initial = connections.length < 4
    connections.push({ socket, path: request.url! })
    socket.on('message', (bytes) => {
      const subscription = JSON.parse(bytes.toString())
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: subscription.id, result: { message: 'Subscribed' } }))
      if (subscription.params.topic === 'l2Orderbook') {
        socket.send(JSON.stringify(book(initial ? 100 : 1)))
        if (!initial) socket.send(JSON.stringify(book(2, 'update')))
      }
    })
  })
  const messages = stream({
    exchange: 'bullish',
    filters: [
      { channel: 'V1TALevel2', symbols: ['BTCUSDC'] },
      { channel: 'V1TAAnonymousTradeUpdate', symbols: ['BTCUSDC'] },
      { channel: 'V1TATickerResponse', symbols: ['BTCUSDC'] },
      { channel: 'V1TAIndexPrice', symbols: ['BTC'] }
    ],
    timeoutIntervalMS: 0,
    withDisconnects: true,
    onError: (error) => errors.push(error)
  })
  try {
    let initialized = false
    while (!initialized || connections.length < 4) {
      const item = (await messages.next()).value
      if (item?.message.dataType === 'V1TALevel2') initialized = true
    }
    const original = connections.slice()
    const orderbook = original.find(({ path }) => path.endsWith('/orderbook'))!
    orderbook.socket.send(JSON.stringify(book(103, 'update')))
    let next = (await messages.next()).value
    while (next !== undefined) {
      assert.notStrictEqual(next.message.dataType, 'V1TALevel2')
      next = (await messages.next()).value
    }
    const recovered = []
    while (recovered.length < 2) {
      const item = (await messages.next()).value
      assert.ok(item !== undefined)
      if (item.message.dataType === 'V1TALevel2') recovered.push(item.message)
    }
    assert.deepStrictEqual(recovered, [book(1), book(2, 'update')])
    for (let attempt = 0; attempt < 200 && (connections.length < 8 || original.some(({ socket }) => socket.readyState !== 3)); attempt++) {
      await sleep(10)
    }
    assert.strictEqual(connections.length, 8)
    assert.ok(original.every(({ socket }) => socket.readyState === 3))
    assert.deepStrictEqual(new Set(connections.slice(4).map(({ path }) => path)), new Set(original.map(({ path }) => path)))
    assert.strictEqual(errors.length, 1)
    assert.ok(errors[0] instanceof SequenceGapError)
  } finally {
    try {
      await messages.return?.()
    } finally {
      await cleanup()
    }
  }
})
