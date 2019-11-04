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
      for (const exchange of EXCHANGES) {
        const exchangeDetails = await getExchangeDetails(exchange)

        const normalizers: any[] = [normalizeTrades]
        // bitstamp issue under node 12 (invalid headers)
        // let's skip book snapshots for it
        if (exchange !== 'bitstamp') {
          normalizers.push(normalizeBookChanges)
        }

        if (exchangesWithDerivativeInfo.includes(exchange)) {
          normalizers.push(normalizeDerivativeTickers)
        }

        var symbols = exchangeDetails.availableSymbols
          .filter(s => s.availableTo === undefined)
          .slice(0, 100)
          .map(s => s.id)

        const messages = streamNormalized(
          {
            exchange,
            symbols,
            withDisconnectMessages: true
          },
          ...normalizers
        )

        let count = 0
        let snapshots = 0
        // check if each symbol received book snapshot
        // and then there was at least 200 messages received after

        for await (const msg of messages) {
          // reset counters if we've received disconnect
          if (msg.type === 'disconnect') {
            count = 0
            snapshots = 0
          }

          if (msg.type === 'book_change' && (msg as any).isSnapshot) {
            snapshots++
          }

          // again bitstamp is an special on here since there's not book change messages for it
          if (exchange === 'bitstamp') {
            count++
            if (count >= 5) {
              break
            }
          }

          if (snapshots === symbols.length) {
            count++
            if (count >= 200) {
              break
            }
          }
        }
      }
    },
    1000 * 60 * 10
  )
})
