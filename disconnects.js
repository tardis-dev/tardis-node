const {
  EXCHANGES,
  getExchangeDetails,
  normalizeBookChanges,
  normalizeDerivativeTickers,
  normalizeTrades,
  streamNormalized,
  combine,
  compute,
  computeBookSnapshots,
  computeTradeBars
} = require('./dist')

const exchangesWithDerivativeInfo = ['bitmex', 'binance-futures', 'bitfinex-derivatives', 'cryptofacilities', 'deribit', 'okex', 'bybit']

async function getNormalizedMessages() {
  return Promise.all(
    EXCHANGES.map(async exchange => {
      const exchangeDetails = await getExchangeDetails(exchange)

      const normalizers = [normalizeTrades]

      // bitstamp issue under node 12 (invalid headers)
      // let's skip book snapshots for it
      if (exchange !== 'bitstamp') {
        normalizers.push(normalizeBookChanges)
      }

      if (exchangesWithDerivativeInfo.includes(exchange)) {
        normalizers.push(normalizeDerivativeTickers)
      }

      let symbols = exchangeDetails.availableSymbols
        .filter(s => s.availableTo === undefined || new Date(s.availableTo) >= new Date())
        .filter(s => s.type !== 'option')
        .map(s => s.id)

      if (exchange === 'binance') {
        symbols = symbols.slice(0, 40)
      }

      return streamNormalized(
        {
          exchange,
          symbols: symbols.slice(0, 100),
          timeoutIntervalMS: 15 * 1000,
          withDisconnectMessages: true,
          onError: err => {
            console.log('--->', new Date().toISOString(), exchange, err)
          }
        },
        ...normalizers
      )
    })
  )
}
// const { monitorEventLoopDelay } = require('perf_hooks')
// const h = monitorEventLoopDelay({ resolution: 1 })
// h.enable()

// setInterval(() => {
//   h.reset()
// }, 30 * 1000)

// var gc = require('gc-stats')()

// gc.on('stats', function(stats) {
//   console.log('GC happened', stats)
// })

async function run() {
  var disconnects = {}
  var last = undefined
  setInterval(() => {
    console.log(last, disconnects)
  }, 1000 * 60)
  const messages = await getNormalizedMessages()

  //console.log('again')
  const withSnaps = compute(
    combine(...messages),
    computeBookSnapshots({ depth: 5, interval: 0, name: 'quote' }),
    computeTradeBars({ interval: 10, kind: 'time' })
  )
  for await (const msg of withSnaps) {
    if (msg === undefined) {
      console.log('fuuuuuck')
    }
    last = msg.localTimestamp

    if (msg.type === 'disconnect') {
      if (!disconnects[msg.exchange]) {
        disconnects[msg.exchange] = 1
      } else {
        disconnects[msg.exchange] += 1
      }
    }
  }
}

run()
