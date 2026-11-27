import { test } from 'node:test'
import { normalizeBookChanges, normalizeBookTickers, normalizeTrades, stream, streamNormalized } from '../dist/index.js'
import { assert } from './assertions.ts'
import { describeLive } from './live.ts'

describeLive('bingx spot live', () => {
  test('streams native BTC-USDT data for every spot channel', { timeout: 40_000 }, async () => {
    const messages = stream({
      exchange: 'bingx',
      filters: (['trade', 'incrDepth', 'bookTicker', 'ticker'] as const).map((channel) => ({ channel, symbols: ['BTC-USDT'] })),
      timeoutIntervalMS: 20_000,
      withDisconnects: true
    })
    const seen = new Set<string>()
    try {
      for await (const result of messages) {
        assert.ok(result, 'BingX disconnected before all channels produced data')
        const { message } = result
        if (!message.dataType?.startsWith('BTC-USDT@')) continue
        assert.ok(message.data)
        const channel = message.dataType.split('@')[1]
        if (channel === 'incrDepth') {
          if (!seen.has('snapshot')) assert.strictEqual(message.data.action, 'all')
          seen.add(message.data.action === 'all' ? 'snapshot' : 'delta')
        } else {
          assert.strictEqual(message.data.s, 'BTC-USDT')
          seen.add(channel)
        }
        if (seen.size === 5) break
      }
    } finally {
      await messages.return?.()
    }
    assert.deepEqual([...seen].sort(), ['bookTicker', 'delta', 'snapshot', 'ticker', 'trade'])
  })

  test('streams normalized BTC-USDT trades, snapshots, deltas and book tickers', { timeout: 40_000 }, async () => {
    const messages = streamNormalized(
      { exchange: 'bingx', symbols: ['BTC-USDT'], timeoutIntervalMS: 20_000, withDisconnectMessages: true },
      normalizeTrades,
      normalizeBookChanges,
      normalizeBookTickers
    )
    const seen = new Set<string>()
    try {
      for await (const message of messages) {
        assert.ok(message.type !== 'disconnect', 'BingX disconnected before all normalized types produced data')
        assert.strictEqual(message.exchange, 'bingx')
        assert.strictEqual(message.symbol, 'BTC-USDT')
        assert.ok(Number.isFinite(message.timestamp.valueOf()))
        if (message.type === 'trade') {
          assert.ok(message.price > 0 && message.amount > 0)
          assert.strictEqual(typeof message.id, 'string')
          seen.add('trade')
        } else if (message.type === 'book_change') {
          if (message.isSnapshot) {
            assert.ok(message.bids.length > 0 && message.asks.length > 0)
            seen.add('snapshot')
          } else {
            assert.ok(seen.has('snapshot'), 'Received a book delta before its snapshot')
            seen.add('delta')
          }
        } else if (message.type === 'book_ticker') {
          assert.ok(message.bidPrice !== undefined && message.bidPrice > 0)
          assert.ok(message.askPrice !== undefined && message.askPrice > 0)
          assert.ok(message.bidAmount !== undefined && message.bidAmount >= 0)
          assert.ok(message.askAmount !== undefined && message.askAmount >= 0)
          seen.add('book_ticker')
        }
        if (seen.size === 4) break
      }
    } finally {
      await messages.return?.()
    }
    assert.deepEqual([...seen].sort(), ['book_ticker', 'delta', 'snapshot', 'trade'])
  })
})
