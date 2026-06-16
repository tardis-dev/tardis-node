import {
  normalizeBookChanges,
  normalizeBookTickers,
  normalizeDerivativeTickers,
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

test('normalizers keep existing exchange support matrix', () => {
  const timestamp = date('2024-01-01T00:00:00.000Z')

  expectSupported(
    normalizeTrades,
    [
      'ascendex',
      'binance',
      'binance-delivery',
      'binance-dex',
      'binance-european-options',
      'binance-futures',
      'binance-jersey',
      'binance-us',
      'bitfinex',
      'bitfinex-derivatives',
      'bitflyer',
      'bitget',
      'bitget-futures',
      'bitmex',
      'bitnomial',
      'bitstamp',
      'blockchain-com',
      'bullish',
      'bybit',
      'bybit-options',
      'bybit-spot',
      'coinbase',
      'coinbase-international',
      'coinflex',
      'crypto-com',
      'cryptofacilities',
      'delta',
      'deribit',
      'dydx',
      'dydx-v4',
      'ftx',
      'ftx-us',
      'gate-io',
      'gate-io-futures',
      'gemini',
      'hitbtc',
      'huobi',
      'huobi-dm',
      'huobi-dm-linear-swap',
      'huobi-dm-options',
      'huobi-dm-swap',
      'hyperliquid',
      'kraken',
      'kucoin',
      'kucoin-futures',
      'lighter',
      'mango',
      'okcoin',
      'okex',
      'okex-futures',
      'okex-options',
      'okex-spreads',
      'okex-swap',
      'phemex',
      'poloniex',
      'polymarket',
      'serum',
      'star-atlas',
      'upbit',
      'woo-x'
    ],
    timestamp
  )

  expectSupported(
    normalizeBookChanges,
    [
      'ascendex',
      'binance',
      'binance-delivery',
      'binance-dex',
      'binance-european-options',
      'binance-futures',
      'binance-jersey',
      'binance-us',
      'bitfinex',
      'bitfinex-derivatives',
      'bitflyer',
      'bitget',
      'bitget-futures',
      'bitmex',
      'bitnomial',
      'bitstamp',
      'blockchain-com',
      'bullish',
      'bybit',
      'bybit-options',
      'bybit-spot',
      'coinbase',
      'coinbase-international',
      'coinflex',
      'crypto-com',
      'cryptofacilities',
      'delta',
      'deribit',
      'dydx',
      'dydx-v4',
      'ftx',
      'ftx-us',
      'gate-io',
      'gate-io-futures',
      'gemini',
      'hitbtc',
      'huobi',
      'huobi-dm',
      'huobi-dm-linear-swap',
      'huobi-dm-options',
      'huobi-dm-swap',
      'hyperliquid',
      'kraken',
      'kucoin',
      'kucoin-futures',
      'lighter',
      'mango',
      'okcoin',
      'okex',
      'okex-futures',
      'okex-options',
      'okex-spreads',
      'okex-swap',
      'phemex',
      'poloniex',
      'polymarket',
      'serum',
      'star-atlas',
      'upbit',
      'woo-x'
    ],
    timestamp
  )

  expectSupported(
    normalizeDerivativeTickers,
    [
      'ascendex',
      'binance-delivery',
      'binance-futures',
      'bitfinex-derivatives',
      'bitget-futures',
      'bitmex',
      'bullish',
      'bybit',
      'coinbase-international',
      'coinflex',
      'crypto-com',
      'cryptofacilities',
      'delta',
      'deribit',
      'dydx',
      'dydx-v4',
      'ftx',
      'gate-io-futures',
      'huobi-dm',
      'huobi-dm-linear-swap',
      'huobi-dm-swap',
      'hyperliquid',
      'kucoin-futures',
      'lighter',
      'okex-futures',
      'okex-swap',
      'phemex',
      'woo-x'
    ],
    timestamp
  )

  expectSupported(
    normalizeOptionsSummary,
    ['binance-european-options', 'bullish', 'bybit-options', 'deribit', 'huobi-dm-options', 'okex-options'],
    timestamp
  )

  expectSupported(
    normalizeLiquidations,
    [
      'binance-delivery',
      'binance-futures',
      'bitfinex-derivatives',
      'bitget-futures',
      'bitmex',
      'bybit',
      'cryptofacilities',
      'deribit',
      'dydx-v4',
      'ftx',
      'huobi-dm',
      'huobi-dm-linear-swap',
      'huobi-dm-swap',
      'lighter',
      'okex-futures',
      'okex-swap'
    ],
    timestamp
  )

  expectSupported(
    normalizeBookTickers,
    [
      'ascendex',
      'binance',
      'binance-delivery',
      'binance-dex',
      'binance-european-options',
      'binance-futures',
      'binance-us',
      'bitfinex',
      'bitfinex-derivatives',
      'bitflyer',
      'bitget',
      'bitget-futures',
      'bitmex',
      'bullish',
      'bybit',
      'bybit-spot',
      'coinbase',
      'coinbase-international',
      'crypto-com',
      'cryptofacilities',
      'delta',
      'deribit',
      'ftx',
      'ftx-us',
      'gate-io',
      'gate-io-futures',
      'huobi',
      'huobi-dm',
      'huobi-dm-linear-swap',
      'huobi-dm-swap',
      'hyperliquid',
      'kraken',
      'kucoin',
      'kucoin-futures',
      'lighter',
      'mango',
      'okcoin',
      'okex',
      'okex-futures',
      'okex-options',
      'okex-spreads',
      'okex-swap',
      'polymarket',
      'serum',
      'star-atlas',
      'woo-x'
    ],
    timestamp
  )
})

test('Bybit mapper switches keep existing filter behavior around switch dates', () => {
  expect(normalizeTrades('bybit', date('2023-04-04T23:59:59.999Z')).getFilters(['BTCUSD'])).toEqual([
    { channel: 'trade', symbols: ['BTCUSD'] }
  ])
  expect(normalizeTrades('bybit', date('2023-04-05T00:00:00.000Z')).getFilters(['BTCUSDT'])).toEqual([
    { channel: 'publicTrade', symbols: ['BTCUSDT'] }
  ])

  expect(normalizeBookChanges('bybit', date('2023-04-04T23:59:59.999Z')).getFilters(['BTCUSD'])).toEqual([
    { channel: 'orderBookL2_25', symbols: ['BTCUSD'] }
  ])
  expect(normalizeBookChanges('bybit', date('2023-04-05T00:00:00.000Z')).getFilters(['BTCUSDT'])).toEqual([
    { channel: 'orderbook.50', symbols: ['BTCUSDT'] }
  ])

  expect(normalizeLiquidations('bybit', date('2025-02-25T23:59:59.999Z')).getFilters(['BTCUSDT'])).toEqual([
    { channel: 'liquidation', symbols: ['BTCUSDT'] }
  ])
  expect(normalizeLiquidations('bybit', date('2025-02-26T00:00:00.000Z')).getFilters(['BTCUSDT'])).toEqual([
    { channel: 'allLiquidation', symbols: ['BTCUSDT'] }
  ])
})

test('OKX mapper switches keep existing book channel windows', () => {
  expect(normalizeBookChanges('okex', date('2020-04-09T23:59:59.999Z')).getFilters(['BTC-USDT'])).toEqual([
    { channel: 'spot/depth_l2_tbt', symbols: ['BTC-USDT'] },
    { channel: 'spot/depth', symbols: ['BTC-USDT'] }
  ])
  expect(normalizeBookChanges('okex', date('2020-04-10T00:00:00.000Z')).getFilters(['BTC-USDT'])).toEqual([
    { channel: 'spot/depth_l2_tbt', symbols: ['BTC-USDT'] }
  ])
  expect(normalizeBookChanges('okex', date('2021-12-23T00:00:00.000Z')).getFilters(['BTC-USDT'])).toEqual([
    { channel: 'books-l2-tbt', symbols: ['BTC-USDT'] }
  ])
  expect(normalizeBookChanges('okex', date('2023-02-25T00:00:00.000Z')).getFilters(['BTC-USDT'])).toEqual([
    { channel: 'books', symbols: ['BTC-USDT'] }
  ])
  expect(normalizeBookChanges('okex', date('2023-03-09T00:00:00.000Z')).getFilters(['BTC-USDT'])).toEqual([
    { channel: 'books-l2-tbt', symbols: ['BTC-USDT'] }
  ])
  expect(normalizeBookChanges('okex', date('2026-05-21T00:00:00.000Z')).getFilters(['BTC-USDT'])).toEqual([
    { channel: 'books', symbols: ['BTC-USDT'] }
  ])
})

test('OKX trades-all env override remains separate from mapper dates', () => {
  expect(normalizeTrades('okex', date('2023-10-19T00:00:00.000Z')).getFilters(['BTC-USDT'])).toEqual([
    { channel: 'trades-all', symbols: ['BTC-USDT'] }
  ])

  process.env.OKX_USE_TRADES_CHANNEL = '1'

  expect(normalizeTrades('okex', date('2023-10-19T00:00:00.000Z')).getFilters(['BTC-USDT'])).toEqual([
    { channel: 'trades', symbols: ['BTC-USDT'] }
  ])
})

function date(value: string) {
  return new Date(value)
}

function expectSupported(
  normalizer: (exchange: any, localTimestamp: Date) => { getFilters: (symbols?: string[]) => unknown },
  exchanges: string[],
  localTimestamp: Date
) {
  for (const exchange of exchanges) {
    expect(() => normalizer(exchange, localTimestamp).getFilters()).not.toThrow()
  }
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
