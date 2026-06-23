import { normalizeBookChanges, normalizeBookTickers, normalizeTrades, streamNormalized } from '../dist/index.js'
import { describeLive } from './live.js'

describeLive('mexc live', () => {
  test('streams normalized BTCUSDT data for all mappers', async () => {
    const messages = streamNormalized(
      {
        exchange: 'mexc',
        symbols: ['BTCUSDT'],
        timeoutIntervalMS: 20_000,
        withDisconnectMessages: true
      },
      normalizeTrades,
      normalizeBookChanges,
      normalizeBookTickers
    )

    const seen = {
      trade: false,
      bookSnapshot: false,
      bookDelta: false,
      bookTicker: false
    }
    let sawDisconnect = false

    try {
      for await (const message of messages) {
        if (message.type === 'disconnect') {
          sawDisconnect = true
          continue
        }

        if (message.symbol !== 'BTCUSDT') {
          continue
        }

        if (message.type === 'trade') {
          seen.trade = message.amount > 0 && Number.isFinite(message.price)
        }

        if (message.type === 'book_ticker') {
          seen.bookTicker = Number.isFinite(message.askPrice ?? NaN) || Number.isFinite(message.bidPrice ?? NaN)
        }

        if (message.type === 'book_change' && message.isSnapshot) {
          seen.bookSnapshot = message.asks.length > 0 || message.bids.length > 0
        }

        if (message.type === 'book_change' && !message.isSnapshot) {
          seen.bookDelta = true
        }

        if (Object.values(seen).every(Boolean)) {
          break
        }
      }
    } finally {
      await messages.return?.()
    }

    expect(sawDisconnect).toBe(false)
    expect(seen).toEqual({
      trade: true,
      bookSnapshot: true,
      bookDelta: true,
      bookTicker: true
    })
  }, 40_000)
})
