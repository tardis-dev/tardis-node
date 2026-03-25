import { normalizeBookChanges, normalizeBookTickers, normalizeDerivativeTickers, normalizeTrades } from '../src/mappers'
import { streamNormalized } from '../src/stream'
import { BookChange, BookTicker, DerivativeTicker, Disconnect, Trade } from '../src/types'

type BinanceFuturesLiveMessage = Trade | BookChange | DerivativeTicker | BookTicker | Disconnect
const testTimeoutMS = 40_000

describe('binance futures supported channels live', () => {
  test(
    'streams normalized BTCUSDT data for supported channels without disconnects',
    async () => {
      const messages: AsyncIterableIterator<BinanceFuturesLiveMessage> = streamNormalized(
        {
          exchange: 'binance-futures',
          symbols: ['btcusdt'],
          timeoutIntervalMS: 60_000,
          withDisconnectMessages: true
        },
        normalizeTrades,
        normalizeBookChanges,
        normalizeDerivativeTickers,
        normalizeBookTickers
      )

      const seen = {
        trade: false,
        bookSnapshot: false,
        bookUpdate: false,
        bookTicker: false,
        lastPrice: false,
        markPrice: false,
        openInterest: false
      }
      let sawDisconnect = false

      for await (const message of messages) {
        if (message.type === 'disconnect') {
          sawDisconnect = true
          continue
        }

        if (message.symbol !== 'BTCUSDT') {
          continue
        }

        if (message.type === 'trade') {
          seen.trade = true
        }

        if (message.type === 'book_change') {
          if (message.isSnapshot) {
            seen.bookSnapshot = true
          } else {
            seen.bookUpdate = true
          }
        }

        if (message.type === 'book_ticker') {
          seen.bookTicker = true
        }

        if (message.type === 'derivative_ticker') {
          if (message.lastPrice !== undefined) {
            seen.lastPrice = true
          }

          if (message.markPrice !== undefined) {
            seen.markPrice = true
          }

          if (message.openInterest !== undefined) {
            seen.openInterest = true
          }
        }

        if (Object.values(seen).every(Boolean)) {
          break
        }
      }

      expect(sawDisconnect).toBe(false)
      expect(seen).toEqual({
        trade: true,
        bookSnapshot: true,
        bookUpdate: true,
        bookTicker: true,
        lastPrice: true,
        markPrice: true,
        openInterest: true
      })
    },
    testTimeoutMS
  )
})
