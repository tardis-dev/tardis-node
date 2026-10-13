import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { WebSocketServer } from 'ws'
import { stream } from '../dist/index.js'
import { assert } from './assertions.ts'

test('Binance futures replay-only channels do not subscribe or disrupt supported streams', { timeout: 10_000 }, async () => {
  const server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const previousUrl = process.env.WSS_URL_BINANCE_FUTURES
  process.env.WSS_URL_BINANCE_FUTURES = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
  const subscriptions: unknown[] = []
  const message = { stream: 'btcusdt@trade', data: { s: 'BTCUSDT', p: '100', q: '1' } }
  server.on('connection', (socket) => {
    socket.on('message', (payload) => {
      subscriptions.push(JSON.parse(payload.toString()))
      socket.send(JSON.stringify(message))
    })
  })

  const messages = stream({
    exchange: 'binance-futures',
    filters: [{ channel: 'fundingRate', symbols: ['btcusdt'] }, { channel: 'tradingSession' }, { channel: 'trade', symbols: ['btcusdt'] }]
  })

  try {
    assert.deepEqual((await messages.next()).value?.message, message)
    assert.deepEqual(subscriptions, [{ method: 'SUBSCRIBE', params: ['btcusdt@trade'], id: 1 }])
  } finally {
    await messages.return?.()
    if (previousUrl === undefined) delete process.env.WSS_URL_BINANCE_FUTURES
    else process.env.WSS_URL_BINANCE_FUTURES = previousUrl
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('Binance futures streaming ends without data when only replay-only channels are requested', { timeout: 10_000 }, async () => {
  const messages = stream({
    exchange: 'binance-futures',
    filters: [{ channel: 'fundingRate' }, { channel: 'tradingSession' }]
  })

  try {
    assert.deepEqual(await messages.next(), { done: true, value: undefined })
  } finally {
    await messages.return?.()
  }
})
