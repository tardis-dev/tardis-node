import { once } from 'node:events'
import { mock, test } from 'node:test'
import { type WebSocket, WebSocketServer } from 'ws'
import * as handy from '../dist/handy.js'
import { assert } from './assertions.ts'

const products = [{ product_id: 'FIRST-CDE' }, { product_id: 'SECOND-CDE' }, { product_id: 'THIRD-CDE' }]

mock.module('../dist/handy.js', {
  exports: {
    ...handy,
    getJSON: async (url: string) => {
      const offset = Number(new URL(url).searchParams.get('offset'))
      return {
        data: {
          products: offset === 0 ? products.slice(0, 1) : products.slice(1),
          pagination: { has_next: offset === 0 }
        }
      }
    }
  }
})

const { stream } = await import('../dist/index.js')

test('Coinbase derivatives subscribes all books on one connection and restarts it after a sequence gap', { timeout: 15000 }, async () => {
  const server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const address = server.address()
  assert.ok(typeof address === 'object' && address !== null)
  const oldUrl = process.env.WSS_URL_COINBASE_DERIVATIVES
  process.env.WSS_URL_COINBASE_DERIVATIVES = `ws://127.0.0.1:${address.port}`
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
    assert.match(errors[0].message, /sequence gap/)
  } finally {
    await feed.return?.()
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (oldUrl === undefined) delete process.env.WSS_URL_COINBASE_DERIVATIVES
    else process.env.WSS_URL_COINBASE_DERIVATIVES = oldUrl
  }
})

test('Coinbase derivatives rejects a book subscription without products', async () => {
  const feed = stream({ exchange: 'coinbase-derivatives', filters: [{ channel: 'l2_data' }] })
  await assert.rejects(feed.next(), /require explicit symbols/)
})

test('Coinbase derivatives streams every REST products page without requested symbols', { timeout: 5000 }, async () => {
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

test('Coinbase derivatives REST products still respect requested symbols', { timeout: 5000 }, async () => {
  for await (const { message } of stream({
    exchange: 'coinbase-derivatives',
    filters: [{ channel: 'products', symbols: ['SECOND-CDE'] }]
  })) {
    assert.deepEqual(message.events, [products[1]])
    break
  }
})
