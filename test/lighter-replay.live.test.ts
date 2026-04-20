import { clearCache, normalizeBookChanges, normalizeDerivativeTickers, normalizeTrades, replayNormalized } from '../dist/index.js'
import { describeLive } from './live.js'

const from = process.env.LIGHTER_REPLAY_TEST_FROM ?? '2026-04-17T00:00:00.000Z'
const to = process.env.LIGHTER_REPLAY_TEST_TO ?? '2026-04-17T00:10:00.000Z'
const symbol = process.env.LIGHTER_REPLAY_TEST_SYMBOL ?? '1'

describeLive('lighter replay live', () => {
  beforeEach(() => {
    return clearCache()
  }, 1000 * 60 * 10)

  test(
    'replays normalized raw market-id data from remote storage',
    async () => {
      const messages = replayNormalized(
        {
          exchange: 'lighter',
          symbols: [symbol],
          from,
          to,
          withDisconnectMessages: true
        },
        normalizeTrades,
        normalizeBookChanges,
        normalizeDerivativeTickers
      )

      const seen = {
        trade: false,
        bookChange: false,
        derivativeTicker: false,
        derivativeTickerValue: false
      }

      for await (const message of messages) {
        if (message.type === 'disconnect') {
          continue
        }

        expect(message.symbol).toBe(symbol)

        if (message.type === 'trade') {
          seen.trade = message.price > 0 && message.amount > 0
        }

        if (message.type === 'book_change') {
          seen.bookChange = message.asks.length > 0 || message.bids.length > 0
        }

        if (message.type === 'derivative_ticker') {
          seen.derivativeTicker = true
          seen.derivativeTickerValue =
            message.markPrice !== undefined ||
            message.indexPrice !== undefined ||
            message.fundingRate !== undefined ||
            message.openInterest !== undefined
        }

        if (Object.values(seen).every(Boolean)) {
          break
        }
      }

      expect(seen).toEqual({
        trade: true,
        bookChange: true,
        derivativeTicker: true,
        derivativeTickerValue: true
      })
    },
    1000 * 60 * 10
  )
})
