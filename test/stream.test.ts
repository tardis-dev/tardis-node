import {
  compute,
  computeBookSnapshots,
  computeTradeBars,
  Exchange,
  EXCHANGES,
  getExchangeDetails,
  normalizeBookChanges,
  normalizeDerivativeTickers,
  normalizeTrades,
  streamNormalized
} from '../dist'

const exchangesWithDerivativeInfo: Exchange[] = [
  'bitmex',
  'binance-futures',
  'binance-delivery',
  'delta',
  'bitfinex-derivatives',
  'cryptofacilities',
  'deribit',
  'okex-futures',
  'okex-swap',
  'bybit',
  'delta'
]

describe('stream', () => {
  test(
    'streams normalized real-time messages for each supported exchange',
    async () => {
      await Promise.all(
        EXCHANGES.map(async (exchange) => {
          if (
            exchange === 'coinflex' ||
            exchange === 'okex-futures' ||
            exchange === 'okex-options' ||
            exchange === 'bybit' ||
            exchange === 'delta' ||
            exchange === 'ftx-us' ||
            exchange === 'binance-delivery' ||
            exchange === 'bitfinex-alts' ||
            exchange === 'gate-io' ||
            exchange === 'huobi'
          ) {
            return
          }
          const exchangeDetails = await getExchangeDetails(exchange)
          const normalizers: any[] = [normalizeTrades, normalizeBookChanges]

          if (exchangesWithDerivativeInfo.includes(exchange)) {
            normalizers.push(normalizeDerivativeTickers)
          }

          var symbols = exchangeDetails.availableSymbols
            .filter((s) => s.availableTo === undefined || new Date(s.availableTo).valueOf() > new Date().valueOf())
            .slice(0, 10)
            .map((s) => s.id)

          const messages = streamNormalized(
            {
              exchange,
              symbols,
              withDisconnectMessages: true,
              timeoutIntervalMS: 20 * 1000,
              onError: (err) => {
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

          for await (const msg of messagesWithComputables) {
            // reset counters if we've received disconnect
            if (msg.type === 'disconnect') {
              count = 0
              snapshots = 0
            }

            if (msg.type === 'book_change' && (msg as any).isSnapshot) {
              snapshots++
            }

            if (exchange === 'binance-dex' || exchange === 'okcoin') {
              count++
              if (count >= 2) {
                break
              }
            }

            if (snapshots >= symbols.length - 1) {
              count++
              if (count >= 50) {
                break
              }
            }
          }
        })
      )
    },
    1000 * 60 * 2
  )
})
