import { afterEach, beforeEach, test } from 'node:test'
import { assert } from './assertions.ts'
import {
  normalizeBookChanges,
  normalizeBookTickers,
  normalizeLiquidations,
  normalizeOptionsSummary,
  normalizeTrades
} from '../dist/index.js'

const originalEnv = {
  __NO_REAL_TIME__: process.env.__NO_REAL_TIME__,
  OKX_API_KEY: process.env.OKX_API_KEY,
  OKX_API_VIP_5: process.env.OKX_API_VIP_5,
  OKX_API_COLO: process.env.OKX_API_COLO,
  OKX_USE_TRADES_CHANNEL: process.env.OKX_USE_TRADES_CHANNEL
}

beforeEach(() => {
  process.env.__NO_REAL_TIME__ = '1'
  delete process.env.OKX_API_KEY
  delete process.env.OKX_API_VIP_5
  delete process.env.OKX_API_COLO
  delete process.env.OKX_USE_TRADES_CHANNEL
})

afterEach(() => restoreEnv(originalEnv))

test('Bybit replay uses the raw channels recorded on each side of its API migrations', () => {
  assert.deepStrictEqual(normalizeTrades('bybit', date('2023-04-04T23:59:59.999Z')).getFilters(['BTCUSD']), [
    { channel: 'trade', symbols: ['BTCUSD'] }
  ])
  assert.deepStrictEqual(normalizeTrades('bybit', date('2023-04-05T00:00:00.000Z')).getFilters(['BTCUSDT']), [
    { channel: 'publicTrade', symbols: ['BTCUSDT'] }
  ])

  assert.deepStrictEqual(normalizeBookChanges('bybit', date('2023-04-04T23:59:59.999Z')).getFilters(['BTCUSD']), [
    { channel: 'orderBookL2_25', symbols: ['BTCUSD'] }
  ])
  assert.deepStrictEqual(normalizeBookChanges('bybit', date('2023-04-05T00:00:00.000Z')).getFilters(['BTCUSDT']), [
    { channel: 'orderbook.50', symbols: ['BTCUSDT'] }
  ])

  assert.deepStrictEqual(normalizeLiquidations('bybit', date('2025-02-25T23:59:59.999Z')).getFilters(['BTCUSDT']), [
    { channel: 'liquidation', symbols: ['BTCUSDT'] }
  ])
  assert.deepStrictEqual(normalizeLiquidations('bybit', date('2025-02-26T00:00:00.000Z')).getFilters(['BTCUSDT']), [
    { channel: 'allLiquidation', symbols: ['BTCUSDT'] }
  ])
})

test('Kraken replay switches book ticker channels without changing mixed-case symbols', () => {
  const beforeSwitch = date('2026-07-09T23:59:59.999Z')
  const switchDate = date('2026-07-10T00:00:00.000Z')
  const symbols = ['AAPLx/USD']

  assert.deepStrictEqual(normalizeTrades('kraken', beforeSwitch).getFilters(symbols), [{ channel: 'trade', symbols }])
  assert.deepStrictEqual(normalizeTrades('kraken', switchDate).getFilters(symbols), [{ channel: 'trade', symbols }])
  assert.deepStrictEqual(normalizeBookChanges('kraken', beforeSwitch).getFilters(symbols), [{ channel: 'book', symbols }])
  assert.deepStrictEqual(normalizeBookChanges('kraken', switchDate).getFilters(symbols), [{ channel: 'book', symbols }])
  assert.deepStrictEqual(normalizeBookTickers('kraken', beforeSwitch).getFilters(symbols), [{ channel: 'spread', symbols }])
  assert.deepStrictEqual(normalizeBookTickers('kraken', switchDate).getFilters(symbols), [{ channel: 'ticker', symbols }])
})

test('Gemini replay uses the v3 depth channel after the recorded API switch', () => {
  const beforeSwitch = date('2026-07-23T23:59:59.999Z')
  const switchDate = date('2026-07-24T00:00:00.000Z')
  const symbols = ['BTCUSD']

  assert.deepStrictEqual(normalizeTrades('gemini', beforeSwitch).getFilters(['btcusd']), [{ channel: 'trade', symbols }])
  assert.deepStrictEqual(normalizeTrades('gemini', switchDate).getFilters(['btcusd']), [{ channel: 'trade', symbols }])
  assert.deepStrictEqual(normalizeBookChanges('gemini', beforeSwitch).getFilters(['btcusd']), [{ channel: 'l2_updates', symbols }])
  assert.deepStrictEqual(normalizeBookChanges('gemini', switchDate).getFilters(['btcusd']), [{ channel: 'depth', symbols }])
  assert.deepStrictEqual(normalizeBookTickers('gemini', beforeSwitch).getFilters(['btcusd']), [{ channel: 'bookTicker', symbols }])
  assert.deepStrictEqual(normalizeBookTickers('gemini', switchDate).getFilters(['btcusd']), [{ channel: 'bookTicker', symbols }])
})

test('OKX replay follows the historical public book-channel windows', () => {
  assert.deepStrictEqual(normalizeBookChanges('okex', date('2020-04-09T23:59:59.999Z')).getFilters(['BTC-USDT']), [
    { channel: 'spot/depth_l2_tbt', symbols: ['BTC-USDT'] },
    { channel: 'spot/depth', symbols: ['BTC-USDT'] }
  ])
  assert.deepStrictEqual(normalizeBookChanges('okex', date('2020-04-10T00:00:00.000Z')).getFilters(['BTC-USDT']), [
    { channel: 'spot/depth_l2_tbt', symbols: ['BTC-USDT'] }
  ])
  assert.deepStrictEqual(normalizeBookChanges('okex', date('2021-12-23T00:00:00.000Z')).getFilters(['BTC-USDT']), [
    { channel: 'books-l2-tbt', symbols: ['BTC-USDT'] }
  ])
  assert.deepStrictEqual(normalizeBookChanges('okex', date('2023-02-25T00:00:00.000Z')).getFilters(['BTC-USDT']), [
    { channel: 'books', symbols: ['BTC-USDT'] }
  ])
  assert.deepStrictEqual(normalizeBookChanges('okex', date('2023-03-09T00:00:00.000Z')).getFilters(['BTC-USDT']), [
    { channel: 'books-l2-tbt', symbols: ['BTC-USDT'] }
  ])
  assert.deepStrictEqual(normalizeBookChanges('okex', date('2026-05-21T00:00:00.000Z')).getFilters(['BTC-USDT']), [
    { channel: 'books', symbols: ['BTC-USDT'] }
  ])
})

test('OKX replay keeps the explicit trades channel override', () => {
  assert.deepStrictEqual(normalizeTrades('okex', date('2023-10-19T00:00:00.000Z')).getFilters(['BTC-USDT']), [
    { channel: 'trades-all', symbols: ['BTC-USDT'] }
  ])

  process.env.OKX_USE_TRADES_CHANNEL = '1'

  assert.deepStrictEqual(normalizeTrades('okex', date('2023-10-19T00:00:00.000Z')).getFilters(['BTC-USDT']), [
    { channel: 'trades', symbols: ['BTC-USDT'] }
  ])
})

test('OKX options replay derives the correct instrument families', () => {
  assert.deepStrictEqual(
    normalizeOptionsSummary('okex-options', date('2026-06-17T00:00:00.000Z')).getFilters([
      'SOL-USD_UM-260618-67-C',
      'SOL-USD_UM-260618-67-P'
    ]),
    [
      { channel: 'opt-summary', symbols: ['SOL-USD_UM'] },
      { channel: 'index-tickers', symbols: ['SOL-USD'] },
      { channel: 'tickers', symbols: ['SOL-USD_UM-260618-67-C', 'SOL-USD_UM-260618-67-P'] },
      { channel: 'open-interest', symbols: ['SOL-USD_UM-260618-67-C', 'SOL-USD_UM-260618-67-P'] },
      { channel: 'mark-price', symbols: ['SOL-USD_UM-260618-67-C', 'SOL-USD_UM-260618-67-P'] }
    ]
  )
})

function date(value: string) {
  return new Date(value)
}

function restoreEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
