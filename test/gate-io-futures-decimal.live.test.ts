import { normalizeBookChanges, normalizeBookTickers, normalizeTrades } from '../src/mappers'
import { streamNormalized } from '../src/stream'
import { describeLive } from './live'

describeLive('gate-io-futures decimal size live', () => {
  test('streams ETH_USDT data with non-zero decimal quantities and without disconnects', async () => {
    const messages = streamNormalized(
      {
        exchange: 'gate-io-futures',
        symbols: ['ETH_USDT'],
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
      bookTicker: false,
      fractionalQuantity: false
    }
    let sawDisconnect = false

    try {
      for await (const message of messages) {
        if (message.type === 'disconnect') {
          sawDisconnect = true
          continue
        }

        if (message.symbol !== 'ETH_USDT') {
          continue
        }

        if (message.type === 'trade') {
          seen.trade = message.amount > 0
          seen.fractionalQuantity ||= !Number.isInteger(message.amount)
        }

        if (message.type === 'book_ticker') {
          seen.bookTicker = (message.askAmount ?? 0) > 0 || (message.bidAmount ?? 0) > 0
          seen.fractionalQuantity ||=
            (message.askAmount !== undefined && !Number.isInteger(message.askAmount)) ||
            (message.bidAmount !== undefined && !Number.isInteger(message.bidAmount))
        }

        if (message.type === 'book_change' && message.isSnapshot) {
          seen.bookSnapshot = message.asks.length > 0 || message.bids.length > 0

          const firstFractionalLevel = [...message.asks, ...message.bids].some((level) => !Number.isInteger(level.amount))
          seen.fractionalQuantity ||= firstFractionalLevel
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
      bookTicker: true,
      fractionalQuantity: true
    })
  }, 40_000)
})
