import { describe, test } from 'node:test'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { assert, snapshot } from './assertions.ts'
import os from 'node:os'
import path from 'node:path'
import { init, normalizeDerivativeTickers, normalizeTrades, replay, replayNormalized } from '../dist/index.js'

describe('replay validation', () => {
  test('invalid args validation', async () => {
    await assert.rejects(replay({ exchange: 'binance', from: 'sdf', to: 'dsf', filters: [] }).next())

    await assert.rejects(replay({ exchange: 'binances' as any, from: '2019-05-05 00:00', to: '2019-05-05 00:05', filters: [] }).next())

    await assert.rejects(replay({ exchange: 'binance', from: '2019-06-05 00:00', to: '2019-05-05 00:05', filters: [] }).next())

    await assert.rejects(replay({ exchange: 'binance', from: '2019-06-05 00:00Z', to: '2019-05-05 00:05Z', filters: [] }).next())

    await assert.rejects(
      replay({ exchange: 'binance', from: '2019-04-05 00:00Z', to: '2019-05-05 00:05Z', filters: [{ channel: 'trades' as any }] }).next()
    )
  })

  test('invalid replayNormalized args validation', async () => {
    await assert.rejects(replayNormalized({ exchange: 'binance', symbols: ['btcusdt'], from: 'sdf', to: 'dsf' }, normalizeTrades).next())

    assert.throws(() =>
      replayNormalized(
        { exchange: 'binances' as any, symbols: ['btcusdt'], from: '2019-05-05 00:00', to: '2019-05-05 00:05' },
        normalizeTrades
      )
    )

    await assert.rejects(
      replayNormalized(
        { exchange: 'binance', symbols: ['btcusdt'], from: '2019-06-05 00:00', to: '2019-05-05 00:05' },
        normalizeTrades
      ).next()
    )

    await assert.rejects(
      replayNormalized(
        { exchange: 'binance', symbols: ['btcusdt'], from: '2019-06-05 00:00Z', to: '2019-05-05 00:05Z' },
        normalizeTrades
      ).next()
    )
  })

  test('Bitstamp replay includes funding alongside trades for empty and omitted symbol lists', async () => {
    const trade = {
      data: { id_str: '2008233133077446656', type: 0, amount: 0.078, price: 2700.5, microtimestamp: '1790956890092000' },
      channel: 'live_trades_ethusd-perp',
      event: 'trade'
    }
    const funding = {
      data: {
        market: 'ethusd-perp',
        mark_price: '2698.27193853',
        index_price: '2697.7360000000003',
        funding_rate: '0.000032',
        timestamp: '1790956891',
        next_funding_time: '1790985600'
      },
      channel: 'funding_rate_ethusd-perp',
      event: 'funding_rate_saved'
    }
    const rows = [
      { timestamp: '2026-10-02T16:01:30.1000000Z', message: trade },
      { timestamp: '2026-10-02T16:01:31.1000000Z', message: funding }
    ]
    const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-bitstamp-replay-'))
    const server = createServer((request, response) => {
      const filters: { channel: string; symbols?: string[] }[] = JSON.parse(
        new URL(request.url!, 'http://localhost').searchParams.get('filters') ?? '[]'
      )
      const selected = rows.filter(({ message }) =>
        filters.some((filter) =>
          filter.symbols?.length
            ? filter.symbols.some((symbol) => message.channel === `${filter.channel}_${symbol}`)
            : message.channel.startsWith(`${filter.channel}_`)
        )
      )
      response.writeHead(200, { 'Content-Encoding': 'gzip' })
      response.end(gzipSync(selected.map(({ timestamp, message }) => `${timestamp} ${JSON.stringify(message)}\n`).join('')))
    })
    try {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      assert.ok(address !== null && typeof address !== 'string')
      init({ endpoint: `http://127.0.0.1:${address.port}/v1`, cacheDir, dataFeedCompression: 'gzip' })
      for (const symbols of [[], undefined]) {
        const messages = []
        for await (const message of replayNormalized(
          { exchange: 'bitstamp', symbols, from: '2026-10-02T16:01:00Z', to: '2026-10-02T16:02:00Z' },
          normalizeTrades,
          normalizeDerivativeTickers
        ))
          messages.push(message)
        assert.deepEqual(
          messages.map((message) => message.type),
          ['trade', 'derivative_ticker']
        )
        const ticker = messages[1]
        assert.ok(ticker.type === 'derivative_ticker')
        assert.equal(ticker.symbol, 'ETHUSD-PERP')
        assert.equal(ticker.lastPrice, 2700.5)
        assert.equal(ticker.fundingRate, 0.000032)
      }
    } finally {
      init()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(cacheDir, { recursive: true, force: true })
    }
  })

  test('Bybit spot raw replay accepts full and RPI channels and preserves their payloads', async () => {
    const filters = ['orderbook.full', 'orderbook.rpi'].map((channel) => ({ channel, symbols: ['BTCUSDT'] }))
    const messages = [
      {
        topic: 'orderbook.full.BTCUSDT',
        type: 'snapshot',
        generated: true,
        data: { s: 'BTCUSDT', u: 10, seq: 20, b: [['100', '2']], a: [] }
      },
      { topic: 'orderbook.full.BTCUSDT', type: 'delta', data: { s: 'BTCUSDT', u: 11, seq: 21, b: [['100', '0']], a: [] } },
      { topic: 'orderbook.rpi.BTCUSDT', type: 'snapshot', data: { s: 'BTCUSDT', u: 10, seq: 20, b: [['100', '2', '3']], a: [] } },
      { topic: 'orderbook.rpi.BTCUSDT', type: 'delta', data: { s: 'BTCUSDT', u: 11, seq: 21, b: [['100', '0', '4']], a: [] } }
    ]
    const requestedFilters: unknown[] = []
    const server = createServer((request, response) => {
      const url = new URL(request.url!, 'http://localhost')
      requestedFilters.push(JSON.parse(url.searchParams.get('filters')!))
      response.writeHead(200, { 'x-compression': 'gzip', 'x-slice-size': '1' })
      response.end(gzipSync(messages.map((message) => `2026-10-06T00:00:00.0000000Z ${JSON.stringify(message)}\n`).join('')))
    })
    const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-bybit-spot-'))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      init({ endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, cacheDir })
      const received = []
      for await (const { message } of replay({ exchange: 'bybit-spot', from: '2026-10-06', to: '2026-10-06T00:01:00Z', filters })) {
        received.push(message)
      }
      assert.deepEqual(received, messages)
      assert.equal(requestedFilters.length, 1)
      assert.deepEqual(requestedFilters[0], filters)
    } finally {
      init()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      rmSync(cacheDir, { recursive: true, force: true })
    }
  })

  test('replays and normalizes a fixed two-minute Coinbase slice from the Tardis API', { timeout: 60_000 }, async () => {
    const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-replay-e2e-'))
    const from = '2019-06-01T00:00:00.000Z'
    const to = '2019-06-01T00:02:00.000Z'

    try {
      init({ cacheDir })
      const rawMessages = []
      const normalizedMessages = []

      for await (const message of replay({
        exchange: 'coinbase',
        from,
        to,
        filters: [{ channel: 'match', symbols: ['ZEC-USDC'] }]
      })) {
        rawMessages.push(message)
      }

      for await (const message of replayNormalized({ exchange: 'coinbase', symbols: ['ZEC-USDC'], from, to }, normalizeTrades)) {
        normalizedMessages.push(message)
      }

      assert.ok(rawMessages.length > 0)
      assert.strictEqual(normalizedMessages.length, rawMessages.length)
      assert.ok(listFiles(cacheDir).some((filePath) => /\.json\.(?:gz|zst)$/.test(filePath)))
      snapshot({ rawMessages, normalizedMessages })
    } finally {
      init()
      rmSync(cacheDir, { force: true, recursive: true })
    }
  })
})

function listFiles(directory: string): string[] {
  if (existsSync(directory) === false) {
    return []
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  })
}
