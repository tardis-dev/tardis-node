import { once } from 'node:events'
import { test } from 'node:test'
import { WebSocketServer } from 'ws'
import { assert } from './assertions.ts'
import { stream, streamNormalized, normalizeBookChanges } from '../dist/index.js'

test('Gate routes mixed markets into separate subscriptions and retains decimal sizes', async (t) => {
  const server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  const previousUrl = process.env.WSS_URL_GATE_IO_FUTURES
  process.env.WSS_URL_GATE_IO_FUTURES = `ws://127.0.0.1:${address.port}`
  t.after(() => {
    if (previousUrl === undefined) delete process.env.WSS_URL_GATE_IO_FUTURES
    else process.env.WSS_URL_GATE_IO_FUTURES = previousUrl
  })
  const connections: { header: string | string[] | undefined; messages: any[] }[] = []
  server.on('connection', (socket, request) => {
    const connection = { header: request.headers['x-gate-size-decimal'], messages: [] as any[] }
    connections.push(connection)
    socket.on('message', (bytes) => {
      const message = JSON.parse(bytes.toString())
      connection.messages.push(message)
      socket.send(JSON.stringify({ channel: message.channel, event: 'subscribe', result: { status: 'success' } }))
    })
  })
  const symbols = ['BTC_USDT', 'ETH_USDT', 'BTC_USD', 'BTC_USD1', 'ETH_USDT_20261023']
  const messages = stream({
    exchange: 'gate-io-futures',
    filters: [
      { channel: 'obu', symbols },
      { channel: 'trades', symbols },
      { channel: 'public_liquidates', symbols: ['ETH_USDT', 'BTC_USD1'] },
      { channel: 'order_book', symbols: ['BTC_USDT'] }
    ]
  })
  try {
    // Five individual OBU subscriptions, four trade batches, two liquidation batches and one legacy book.
    for (let i = 0; i < 12; i++) await messages.next()
    assert.strictEqual(connections.length, 4)
    assert.ok(connections.every((c) => c.header === '1'))
    const subscriptions = connections.flatMap((c) => c.messages)
    assert.deepStrictEqual(
      subscriptions
        .filter((s) => s.channel === 'futures.obu')
        .flatMap((s) => s.payload)
        .sort(),
      ['ob.BTC_USD.400', 'ob.BTC_USD1.400', 'ob.BTC_USDT.400', 'ob.ETH_USDT.400', 'ob.ETH_USDT_20261023.100'].sort()
    )
    for (const connection of connections) {
      const trade = connection.messages.find((s) => s.channel === 'futures.trades')
      const bookSymbols = connection.messages
        .filter((s) => s.channel === 'futures.obu')
        .map((s) => s.payload[0].slice(3, s.payload[0].lastIndexOf('.')))
      assert.deepStrictEqual(trade.payload.sort(), bookSymbols.sort())
    }
    assert.deepStrictEqual(subscriptions.find((s) => s.channel === 'futures.order_book').payload, ['BTC_USDT', '20', '0'])
  } finally {
    await messages.return!()
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('Gate OBU normalized streaming initializes again after reconnect', async (t) => {
  const server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  const previousUrl = process.env.WSS_URL_GATE_IO_FUTURES
  process.env.WSS_URL_GATE_IO_FUTURES = `ws://127.0.0.1:${address.port}`
  t.after(() => {
    if (previousUrl === undefined) delete process.env.WSS_URL_GATE_IO_FUTURES
    else process.env.WSS_URL_GATE_IO_FUTURES = previousUrl
  })
  let connections = 0
  server.on('connection', (socket) => {
    const generation = ++connections
    socket.once('message', (bytes) => {
      const subscription = JSON.parse(bytes.toString())
      assert.strictEqual(subscription.channel, 'futures.obu')
      socket.send(
        JSON.stringify({
          channel: 'futures.obu',
          event: 'update',
          result: {
            s: 'ob.ETH_USDT.400',
            t: 1791797259343,
            full: true,
            u: 100,
            b: [['2500', generation === 1 ? '0.25' : '0.5']],
            a: [['2501', '1']]
          }
        })
      )
      socket.send(
        JSON.stringify({
          channel: 'futures.obu',
          event: 'update',
          result: {
            s: 'ob.ETH_USDT.400',
            t: 1791797259443,
            U: 101,
            u: 101,
            b: [['2500', '0']]
          }
        })
      )
      if (generation === 1) socket.close()
    })
  })
  const messages = streamNormalized({ exchange: 'gate-io-futures', symbols: ['ETH_USDT'] }, normalizeBookChanges)
  try {
    const first = await messages.next()
    const delta = await messages.next()
    const reconnected = await messages.next()
    assert.strictEqual(first.value?.isSnapshot, true)
    assert.deepStrictEqual(first.value?.bids, [{ price: 2500, amount: 0.25 }])
    assert.strictEqual(delta.value?.isSnapshot, false)
    assert.deepStrictEqual(delta.value?.bids, [{ price: 2500, amount: 0 }])
    assert.strictEqual(reconnected.value?.isSnapshot, true)
    assert.deepStrictEqual(reconnected.value?.bids, [{ price: 2500, amount: 0.5 }])
    assert.strictEqual(connections, 2)
  } finally {
    await messages.return!()
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('Gate rejects absent symbols, unknown settlement and delivery liquidations', async () => {
  for (const filter of [
    { channel: 'obu' as const },
    { channel: 'obu' as const, symbols: [] },
    { channel: 'obu' as const, symbols: ['BTC_EUR'] },
    { channel: 'public_liquidates' as const, symbols: ['ETH_USDT_20261023'] }
  ]) {
    const messages = stream({ exchange: 'gate-io-futures', filters: [filter] })
    await assert.rejects(messages.next())
    await messages.return!()
  }
})
