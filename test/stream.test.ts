import {
  Exchange,
  EXCHANGES,
  getExchangeDetails,
  normalizeBookChanges,
  normalizeDerivativeTickers,
  normalizeTrades,
  streamNormalized,
  compute,
  computeBookSnapshots,
  computeTradeBars
} from '../dist'

const exchangesWithDerivativeInfo: Exchange[] = [
  'bitmex',
  'binance-futures',
  'bitfinex-derivatives',
  'cryptofacilities',
  'deribit',
  'okex',
  'bybit'
]

describe('stream', () => {
  test(
    'streams normalized real-time messages for each supported exchange',
    async () => {
      await Promise.all(
        EXCHANGES.map(async exchange => {
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
            .filter(s => s.availableTo === undefined || new Date(s.availableTo).valueOf() > new Date().valueOf())
            .filter(s => s.type !== 'option')
            .slice(0, 10)
            .map(s => s.id)

          const messages = streamNormalized(
            {
              exchange,
              symbols,
              withDisconnectMessages: true,
              timeoutIntervalMS: 20 * 1000,
              onError: err => {
                console.log('Error', err)
              }
            },
            ...normalizers
          )

          const messagesWithComputables = compute(
            messages,
            computeTradeBars({ interval: 10, kind: 'time' }),
            computeBookSnapshots({ interval: 0, depth: 3 })
          )

          let count = 0
          let snapshots = 0
          // check if each symbol received book snapshot
          // and then there was at least 200 messages received after

          for await (const msg of messagesWithComputables) {
            // reset counters if we've received disconnect
            if (msg.type === 'disconnect') {
              count = 0
              snapshots = 0
            }

            if (msg.type === 'book_change' && (msg as any).isSnapshot) {
              snapshots++
            }

            // bitstamp and binance dex do not produce many messages
            if (exchange === 'bitstamp' || exchange === 'binance-dex') {
              count++
              if (count >= 5) {
                break
              }
            }

            if (snapshots >= symbols.length) {
              count++
              if (count >= 50) {
                break
              }
            }
          }
        })
      )
    },
    1000 * 60 * 4
  )
})
