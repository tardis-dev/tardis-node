import { once } from 'node:events'
import { test } from 'node:test'
import { WebSocketServer } from 'ws'
import { normalizeTrades, stream, streamNormalized } from '../dist/index.js'
import type { Exchange, Filter } from '../dist/index.js'
import { assert } from './assertions.ts'
import { requestedWaits } from './instant-waits.ts'

async function reportedError(exchange: Exchange, filters: Filter<string>[]) {
  let reportError: (error: Error) => void
  const reported = new Promise<Error>((resolve) => (reportError = resolve))
  const messages = stream({ exchange, filters, withDisconnects: true, onError: (error) => reportError(error) })
  try {
    void messages.next()
    return await reported
  } finally {
    await messages.return?.()
  }
}

for (const symbols of [undefined, []]) {
  test(`Delta reports missing symbols for market data channels: ${JSON.stringify(symbols)}`, { timeout: 10000 }, async () => {
    const error = await reportedError('delta', [{ channel: 'l2_updates', symbols }])
    assert.match(error.message, /DeltaRealTimeFeed requires explicitly specified symbols/)
  })

  test(`FTX instrument poller reports missing symbols: ${JSON.stringify(symbols)}`, { timeout: 10000 }, async () => {
    const error = await reportedError('ftx', [{ channel: 'instrument', symbols }])
    assert.match(error.message, /FTXRealTimeFeed requires explicitly specified symbols/)
  })

  for (const channel of ['open_interest', 'option_index', 'option_market_index']) {
    test(`Huobi options ${channel} poller reports missing symbols: ${JSON.stringify(symbols)}`, { timeout: 10000 }, async () => {
      const error = await reportedError('huobi-dm-options', [{ channel, symbols }])
      assert.match(error.message, /HuobiRealTimeFeed requires explicitly specified symbols/)
    })
  }
}

test('streamNormalized waits before retrying a feed that rejects missing symbols', { timeout: 10000 }, async () => {
  const waitsAtErrors: number[] = []
  let reportSecondError: () => void
  const secondError = new Promise<void>((resolve) => (reportSecondError = resolve))
  const messages = streamNormalized(
    {
      exchange: 'whitebit',
      onError: () => {
        if (waitsAtErrors.push(requestedWaits.length) === 2) reportSecondError()
      }
    },
    normalizeTrades
  )
  try {
    void messages.next()
    await secondError
  } finally {
    await messages.return?.()
  }
  const waits = requestedWaits.slice(waitsAtErrors[0], waitsAtErrors[1])
  assert.ok(Math.max(...waits) >= 1000, `retried after waiting ${waits}`)
})

test('Delta subscribes symbol-free channels without symbols', { timeout: 10000 }, async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  const previousURL = process.env.WSS_URL_DELTA
  process.env.WSS_URL_DELTA = `ws://127.0.0.1:${address.port}`
  const subscription = new Promise<unknown>((resolve) =>
    server.on('connection', (socket) => socket.once('message', (data) => resolve(JSON.parse(String(data)))))
  )
  const messages = stream({ exchange: 'delta', filters: [{ channel: 'product_updates' }], timeoutIntervalMS: 0 })
  try {
    void messages.next()
    assert.deepStrictEqual(await subscription, { type: 'subscribe', payload: { channels: [{ name: 'product_updates' }] } })
  } finally {
    await messages.return?.()
    if (previousURL === undefined) delete process.env.WSS_URL_DELTA
    else process.env.WSS_URL_DELTA = previousURL
    for (const client of server.clients) client.terminate()
    server.close()
  }
})
