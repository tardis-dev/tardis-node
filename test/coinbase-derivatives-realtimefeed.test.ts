import { test } from 'node:test'
import type { WebSocket } from 'ws'
import { stream, streamNormalized, normalizeBookChanges, SequenceGapError } from '../dist/index.js'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'

const products = [{ product_id: 'FIRST-CDE' }, { product_id: 'SECOND-CDE' }, { product_id: 'THIRD-CDE' }]

const productsPage = async (url: string) => {
  const offset = Number(new URL(url).searchParams.get('offset'))
  return Response.json({
    products: offset === 0 ? products.slice(0, 1) : products.slice(1),
    pagination: { has_next: offset === 0 }
  })
}

test('Coinbase derivatives subscribes all books on one connection and restarts it after a sequence gap', { timeout: 15000 }, async () => {
  const { server, cleanup } = await createTestWebSocketServer('coinbase-derivatives')
  const connections: { socket: WebSocket; sequence: number }[] = []
  const errors: Error[] = []
  server.on('connection', (socket) => {
    const connection = { socket, sequence: 0 }
    connections.push(connection)
    socket.on('message', (bytes) => {
      const message = JSON.parse(bytes.toString())
      socket.send(JSON.stringify({ channel: 'subscriptions', sequence_num: connection.sequence++, events: [] }))
      if (message.channel === 'level2') {
        for (const product_id of message.product_ids)
          socket.send(
            JSON.stringify({
              channel: 'l2_data',
              sequence_num: connection.sequence++,
              timestamp: '2026-10-06T10:00:00Z',
              events: [{ type: 'snapshot', product_id, updates: [] }]
            })
          )
      }
    })
  })
  const symbols = Array.from({ length: 26 }, (_, i) => `TEST-${i}-CDE`)
  const feed = stream({
    exchange: 'coinbase-derivatives',
    filters: [{ channel: 'l2_data', symbols }],
    withDisconnects: true,
    onError: (error) => errors.push(error)
  })
  const snapshotsBeforeDisconnect = new Set<string>()
  const snapshotsAfterDisconnect = new Set<string>()
  let disconnects = 0
  try {
    for await (const item of feed) {
      if (item === undefined) {
        disconnects++
        continue
      }
      if (item.message.channel !== 'l2_data') continue
      const symbol = item.message.events[0].product_id
      if (disconnects === 0) {
        snapshotsBeforeDisconnect.add(symbol)
        if (snapshotsBeforeDisconnect.size === symbols.length) {
          const [first] = connections
          first.socket.send(JSON.stringify({ channel: 'heartbeats', sequence_num: first.sequence + 1, events: [] }))
        }
      } else {
        snapshotsAfterDisconnect.add(symbol)
        if (snapshotsAfterDisconnect.size === symbols.length) break
      }
    }
    assert.equal(connections.length, 2)
    assert.equal(disconnects, 1)
    assert.equal(errors.length, 1)
    assert.ok(errors[0] instanceof SequenceGapError)
    assert.strictEqual(errors[0].key, 'connection')
  } finally {
    try {
      await feed.return?.()
    } finally {
      await cleanup()
    }
  }
})

test('Coinbase derivatives rejects a book subscription without products', async () => {
  const feed = stream({ exchange: 'coinbase-derivatives', filters: [{ channel: 'l2_data' }] })
  await assert.rejects(feed.next(), /require explicit symbols/)
})

test('Coinbase derivatives streams every REST products page without requested symbols', { timeout: 5000 }, async (context) => {
  context.mock.method(globalThis, 'fetch', productsPage)
  const output = []
  for await (const { message } of stream({ exchange: 'coinbase-derivatives', filters: [{ channel: 'products' }] })) {
    output.push(message)
    if (output.length === products.length) break
  }
  assert.deepEqual(
    output,
    products.map((product) => ({ channel: 'products', generated: true, events: [product] }))
  )
})

test('Coinbase derivatives REST products still respect requested symbols', { timeout: 5000 }, async (context) => {
  context.mock.method(globalThis, 'fetch', productsPage)
  for await (const { message } of stream({
    exchange: 'coinbase-derivatives',
    filters: [{ channel: 'products', symbols: ['SECOND-CDE'] }]
  })) {
    assert.deepEqual(message.events, [products[1]])
    break
  }
})

for (const channel of ['subscriptions', 'heartbeats', 'l2_data', 'market_trades', 'ticker']) {
  for (const validateSequence of [undefined, false]) {
    test(`Coinbase derivatives ${channel}: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
      const message = (channel: string, sequence_num: number) => ({ channel, sequence_num, events: [] })
      const valid = [
        { channel: 'subscriptions', events: [] },
        message('heartbeats', 0),
        message('subscriptions', 1),
        message('l2_data', 2),
        message('ticker', 3),
        message('market_trades', 4),
        message('l2_data', 4),
        message('heartbeats', 5)
      ]
      const gap = message(channel, 7)
      const errors: Error[] = []
      const { server, cleanup } = await createTestWebSocketServer('coinbase-derivatives')
      server.on('connection', (socket) =>
        socket.once('message', () => {
          for (const item of [...valid, gap]) socket.send(JSON.stringify(item))
        })
      )
      const messages = stream({
        exchange: 'coinbase-derivatives',
        filters: [{ channel: 'l2_data', symbols: ['BIP-20DEC30-CDE', 'ETP-20DEC30-CDE'] }],
        timeoutIntervalMS: 0,
        validateSequence,
        withDisconnects: true,
        onError: (error) => errors.push(error)
      })
      try {
        for (const item of valid) assert.deepStrictEqual((await messages.next()).value?.message, item)
        const next = (await messages.next()).value
        if (validateSequence === false) {
          assert.deepStrictEqual(next?.message, gap)
          assert.deepStrictEqual(errors, [])
        } else {
          assert.strictEqual(next, undefined)
          assert.strictEqual(errors.length, 1)
          assert.ok(errors[0] instanceof SequenceGapError)
          assert.strictEqual(errors[0].exchange, 'coinbase-derivatives')
          assert.strictEqual(errors[0].key, 'connection')
          assert.strictEqual(errors[0].expectedPreviousSequence, 5)
          assert.strictEqual(errors[0].previousSequence, 6)
          assert.strictEqual(errors[0].sequence, 7)
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

for (const validateSequence of [undefined, false]) {
  test(`Coinbase derivatives normalized book recovery: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const book = (sequence_num: number, type: 'snapshot' | 'update', amount: number) => ({
      channel: 'l2_data',
      sequence_num,
      timestamp: '2026-11-06T09:00:00Z',
      events: [
        {
          type,
          product_id: 'BIP-20DEC30-CDE',
          updates: [{ side: 'bid', price_level: '100', new_quantity: String(amount), event_time: '2026-11-06T09:00:00Z' }]
        }
      ]
    })
    let connections = 0
    const errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('coinbase-derivatives')
    server.on('connection', (socket) => {
      const first = ++connections === 1
      let sequence = 0
      socket.on('message', (bytes) => {
        const request = JSON.parse(bytes.toString())
        socket.send(JSON.stringify({ channel: 'subscriptions', sequence_num: sequence++, events: [] }))
        if (request.channel === 'level2') {
          socket.send(JSON.stringify(book(sequence++, 'snapshot', first ? 100 : 200)))
          socket.send(JSON.stringify(book(first ? sequence + 1 : sequence, 'update', first ? 101 : 201)))
        }
      })
    })
    const messages = streamNormalized(
      {
        exchange: 'coinbase-derivatives',
        symbols: ['BIP-20DEC30-CDE'],
        timeoutIntervalMS: 0,
        validateSequence,
        withDisconnectMessages: true,
        onError: (error) => errors.push(error)
      },
      normalizeBookChanges
    )
    try {
      const initial = (await messages.next()).value
      assert.ok(initial.type === 'book_change' && initial.isSnapshot)
      assert.deepStrictEqual(initial.bids, [{ price: 100, amount: 100 }])
      if (validateSequence === false) {
        const update = (await messages.next()).value
        assert.ok(update.type === 'book_change' && !update.isSnapshot)
        assert.deepStrictEqual(update.bids, [{ price: 100, amount: 101 }])
        assert.strictEqual(connections, 1)
        assert.deepStrictEqual(errors, [])
      } else {
        assert.strictEqual((await messages.next()).value.type, 'disconnect')
        const snapshot = (await messages.next()).value
        assert.ok(snapshot.type === 'book_change' && snapshot.isSnapshot)
        assert.deepStrictEqual(snapshot.bids, [{ price: 100, amount: 200 }])
        const update = (await messages.next()).value
        assert.ok(update.type === 'book_change' && !update.isSnapshot)
        assert.deepStrictEqual(update.bids, [{ price: 100, amount: 201 }])
        assert.strictEqual(connections, 2)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
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

test('Coinbase derivatives sequence recovery restarts the products poller alongside the WebSocket', { timeout: 15000 }, async (context) => {
  context.mock.method(globalThis, 'fetch', productsPage)
  const { server, cleanup } = await createTestWebSocketServer('coinbase-derivatives')
  const connections: WebSocket[] = []
  server.on('connection', (socket) => {
    connections.push(socket)
    let sequence = 0
    socket.on('message', (bytes) => {
      const request = JSON.parse(bytes.toString())
      socket.send(JSON.stringify({ channel: 'subscriptions', sequence_num: sequence++, events: [] }))
      if (request.channel === 'level2') socket.send(JSON.stringify({ channel: 'l2_data', sequence_num: sequence++, events: [] }))
    })
  })
  const errors: Error[] = []
  const messages = stream({
    exchange: 'coinbase-derivatives',
    filters: [{ channel: 'l2_data', symbols: ['BIP-20DEC30-CDE'] }, { channel: 'products' }],
    timeoutIntervalMS: 0,
    withDisconnects: true,
    onError: (error) => errors.push(error)
  })
  const before = new Set<string>(),
    after = new Set<string>()
  let boundaries = 0,
    bookBefore = false,
    bookAfter = false,
    injected = false
  try {
    for await (const item of messages) {
      if (item === undefined) {
        boundaries++
        continue
      }
      if (item.message.channel === 'products')
        for (const product of item.message.events) (boundaries ? after : before).add(product.product_id)
      if (item.message.channel === 'l2_data') {
        if (boundaries) bookAfter = true
        else bookBefore = true
      }
      if (!injected && before.size === products.length && bookBefore) {
        injected = true
        connections[0].send(JSON.stringify({ channel: 'heartbeats', sequence_num: 4, events: [] }))
      }
      if (after.size === products.length && bookAfter) break
    }
    assert.strictEqual(boundaries, 1)
    assert.strictEqual(connections.length, 2)
    assert.strictEqual(errors.length, 1)
    assert.ok(errors[0] instanceof SequenceGapError)
    assert.deepStrictEqual(after, before)
  } finally {
    try {
      await messages.return?.()
    } finally {
      await cleanup()
    }
  }
})
