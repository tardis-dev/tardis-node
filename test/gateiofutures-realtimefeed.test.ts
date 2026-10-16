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

test('Gate OBU rejects discontinuities before output and recovers from a fresh snapshot', { timeout: 15000 }, async (t) => {
  for (const invalid of [
    { U: 104, u: 105 }, // missing update 103
    { U: 102, u: 102 }, // duplicate
    { U: 103 }, // missing end sequence
    { U: 103, u: 102 } // reversed range
  ]) {
    await t.test(JSON.stringify(invalid), async () => {
      const server = new WebSocketServer({ port: 0 })
      await once(server, 'listening')
      const address = server.address()
      assert.ok(address !== null && typeof address !== 'string')
      const previousUrl = process.env.WSS_URL_GATE_IO_FUTURES
      process.env.WSS_URL_GATE_IO_FUTURES = `ws://127.0.0.1:${address.port}`
      let connections = 0
      const errors: Error[] = []
      server.on('connection', (socket) => {
        const generation = ++connections
        socket.once('message', () => {
          const push = (symbol: string, result: object) =>
            socket.send(
              JSON.stringify({
                channel: 'futures.obu',
                event: 'update',
                result: { s: `ob.${symbol}.400`, t: 1791797259343, ...result }
              })
            )
          if (generation === 1) {
            push('BTC_USDT', { full: true, u: 100, b: [['100', '1']] })
            push('ETH_USDT', { full: true, u: 900, b: [['200', '1']] })
            push('BTC_USDT', { U: 101, u: 102 }) // empty updates still advance sequence
            push('BTC_USDT', { ...invalid, b: [['100', '99']] })
            push('BTC_USDT', { U: 106, u: 107, b: [['100', '99']] })
          } else if (generation === 2) {
            // This would match stale sequence state if reconnect did not clear it.
            push('BTC_USDT', { U: 103, u: 104, b: [['100', '99']] })
          } else {
            push('BTC_USDT', { full: true, u: 500, b: [['100', '2']] })
            push('BTC_USDT', { U: 501, u: 502, b: [['100', '3']] })
            push('BTC_USDT', { full: true, u: 10, b: [['100', '4']] })
            push('BTC_USDT', { U: 11, u: 11, b: [['100', '0']] })
          }
        })
      })
      const messages = streamNormalized(
        {
          exchange: 'gate-io-futures',
          symbols: ['BTC_USDT', 'ETH_USDT'],
          withDisconnectMessages: true,
          onError: (error) => errors.push(error)
        },
        normalizeBookChanges
      )
      try {
        const output = []
        for await (const message of messages) {
          output.push(message)
          if (message.type === 'book_change' && message.bids[0]?.amount === 0) break
        }
        assert.strictEqual(connections, 3)
        assert.strictEqual(errors.length, 2)
        assert.ok(errors.every((error) => error.message.includes('OBU sequence gap')))
        assert.strictEqual(output.filter((message) => message.type === 'disconnect').length, 2)
        const books = output.filter((message) => message.type === 'book_change')
        assert.deepStrictEqual(
          books.map((message) => message.bids[0]?.amount),
          [1, 1, undefined, 2, 3, 4, 0]
        )
        assert.deepStrictEqual(
          books.map((message) => message.isSnapshot),
          [true, true, false, true, false, true, false]
        )
      } finally {
        await messages.return!()
        for (const socket of server.clients) socket.terminate()
        await new Promise<void>((resolve) => server.close(() => resolve()))
        if (previousUrl === undefined) delete process.env.WSS_URL_GATE_IO_FUTURES
        else process.env.WSS_URL_GATE_IO_FUTURES = previousUrl
      }
    })
  }
})
