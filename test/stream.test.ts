import {
  Exchange,
  EXCHANGES,
  getExchangeDetails,
  normalizeBookChanges,
  normalizeDerivativeTickers,
  normalizeTrades,
  streamNormalized
} from '../dist'

const exchangesWithDerivativeInfo: Exchange[] = ['bitmex', 'binance-futures', 'bitfinex-derivatives', 'cryptofacilities', 'deribit', 'okex']

describe('stream', () => {
  test(
    'streams normalized real-time messages for each supported exchange',
    async () => {
      const skippedExchanges = ['bitstamp', 'binance-dex']
      for (const exchange of EXCHANGES) {
        if (skippedExchanges.includes(exchange)) {
          continue
        }

        const exchangeDetails = await getExchangeDetails(exchange)
        const normalizers = exchangesWithDerivativeInfo.includes(exchange)
          ? [normalizeTrades, normalizeBookChanges, normalizeDerivativeTickers]
          : [normalizeTrades, normalizeBookChanges]

        const validPrefixes = ['btc', 'xbt', 'pi_']
        const availableSymbols = exchangeDetails.availableSymbols.filter(s =>
          validPrefixes.some(p => s.id.toLocaleLowerCase().startsWith(p))
        )
        const messages = streamNormalized(
          {
            exchange,
            symbols: availableSymbols
              .filter(s => s.availableTo === undefined)
              .slice(0, 2)
              .map(s => s.id)
          },
          ...(normalizers as any)
        )

        let count = 0
        for await (const _ of messages) {
          if (count >= 50) {
            break
          }
          count++
        }
      }
    },

    1000 * 60 * 10
  )
})
