import { normalizeBookChanges, streamNormalized } from '../dist/index.js'
import { describeLive } from './live.js'

describeLive('mexc live', () => {
  test('streams normalized BTCUSDT book changes', async () => {
    const messages = streamNormalized(
      {
        exchange: 'mexc',
        symbols: ['BTCUSDT'],
        timeoutIntervalMS: 20_000,
        withDisconnectMessages: true
      },
      normalizeBookChanges
    )

    let sawBookSnapshot = false
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

        if (message.type === 'book_change') {
          if (message.isSnapshot) {
            sawBookSnapshot = message.asks.length > 0 || message.bids.length > 0
          }
        }

        if (sawBookSnapshot) {
          break
        }
      }
    } finally {
      await messages.return?.()
    }

    expect(sawDisconnect).toBe(false)
    expect(sawBookSnapshot).toBe(true)
  }, 40_000)
})
