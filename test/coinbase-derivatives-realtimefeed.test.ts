import { once } from 'node:events'
import { mock, test } from 'node:test'
import { WebSocketServer } from 'ws'
import * as handy from '../dist/handy.js'
import { assert } from './assertions.ts'

const products = [
  { product_id: 'FIRST-CDE', product_venue: 'FCM', future_product_details: { venue: 'cde' } },
  { product_id: 'SECOND-CDE', product_venue: 'OTHER', future_product_details: { venue: 'other' } },
  { product_id: 'THIRD-CDE' }
]

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

test('Coinbase derivatives groups books and reconnects only the connection with a sequence gap', { timeout: 15000 }, async () => {
  const server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const address = server.address()
  assert.ok(typeof address === 'object' && address !== null)
  const oldUrl = process.env.WSS_URL_COINBASE_DERIVATIVES
  process.env.WSS_URL_COINBASE_DERIVATIVES = `ws://127.0.0.1:${address.port}`
  let connections = 0
  let injected = false
  let failedSymbol: string | undefined
  let healthySymbol: string | undefined
  const errors: Error[] = []
  server.on('connection', (socket) => {
    connections++
    let sequence = 0
    socket.on('message', (bytes) => {
      const message = JSON.parse(bytes.toString())
      socket.send(JSON.stringify({ channel: 'subscriptions', sequence_num: sequence++, events: [] }))
      if (message.channel === 'level2') {
        assert.ok(message.product_ids.length <= 25)
        if (!injected) {
          failedSymbol = message.product_ids[0]
        } else if (!message.product_ids.includes(failedSymbol)) {
          healthySymbol = message.product_ids[0]
        }
        for (const product_id of message.product_ids)
          socket.send(
            JSON.stringify({
              channel: 'l2_data',
              sequence_num: sequence++,
              timestamp: '2026-10-06T10:00:00Z',
              events: [{ type: 'snapshot', product_id, updates: [] }]
            })
          )
        if (!injected) {
          injected = true
          socket.send(JSON.stringify({ channel: 'heartbeats', sequence_num: sequence + 1, events: [] }))
        }
      }
    })
  })
  const symbols = Array.from({ length: 26 }, (_, i) => `TEST-${i}-CDE`)
  const feed = stream({
    exchange: 'coinbase-derivatives',
    filters: [{ channel: 'l2_data', symbols }],
    onError: (error) => errors.push(error)
  })
  const seen = new Map<string, number>()
  try {
    for await (const { message } of feed) {
      if (message.channel !== 'l2_data') continue
      const symbol = message.events[0].product_id
      seen.set(symbol, (seen.get(symbol) ?? 0) + 1)
      if (seen.size === 26 && failedSymbol !== undefined && seen.get(failedSymbol) === 2) break
    }
    assert.equal(connections, 3)
    assert.ok(healthySymbol !== undefined)
    assert.equal(seen.get(healthySymbol), 1)
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

test('Coinbase derivatives preserves all REST products regardless of venue', { timeout: 5000 }, async () => {
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
