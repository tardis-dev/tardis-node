import { normalizeDerivativeTickers } from '../src/mappers'
import { streamNormalized } from '../src/stream'

const describeLive = process.env.RUN_LIVE_BINANCE_TESTS === '1' ? describe : describe.skip

describeLive('binance open interest live', () => {
  const originalPollingInterval = process.env.BINANCE_FUTURES_OPEN_INTEREST_POLLING_INTERVAL_MS

  beforeAll(() => {
    process.env.BINANCE_FUTURES_OPEN_INTEREST_POLLING_INTERVAL_MS = '5000'
  })

  afterAll(() => {
    if (originalPollingInterval === undefined) {
      delete process.env.BINANCE_FUTURES_OPEN_INTEREST_POLLING_INTERVAL_MS
    } else {
      process.env.BINANCE_FUTURES_OPEN_INTEREST_POLLING_INTERVAL_MS = originalPollingInterval
    }
  })

  test('streams normalized derivative tickers with open interest from binance futures', async () => {
    const symbols = ['btcusdt', 'ethusdt', 'bnbusdt']
    const messages = streamNormalized(
      {
        exchange: 'binance-futures',
        symbols,
        timeoutIntervalMS: 10_000
      },
      normalizeDerivativeTickers
    )
    const openInterestBySymbol = new Map<string, number>()
    let didTimeout = false
    const timeoutId = setTimeout(() => {
      didTimeout = true
      void messages.return?.()
    }, 20_000)

    try {
      for await (const message of messages) {
        if (message.type !== 'derivative_ticker' || message.openInterest === undefined) {
          continue
        }

        openInterestBySymbol.set(message.symbol, message.openInterest)

        if (openInterestBySymbol.size === symbols.length) {
          break
        }
      }
    } finally {
      clearTimeout(timeoutId)
      await messages.return?.()
    }

    expect(didTimeout).toBe(false)
    expect(Array.from(openInterestBySymbol.keys()).sort()).toEqual(['BNBUSDT', 'BTCUSDT', 'ETHUSDT'])

    for (const openInterest of openInterestBySymbol.values()) {
      expect(openInterest).toBeGreaterThanOrEqual(0)
    }
  }, 20_000)
})
