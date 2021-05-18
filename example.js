const { replayNormalized, streamNormalized, normalizeTrades, compute, computeTradeBars } = require('tardis-dev')

const historicalMessages = replayNormalized(
  {
    exchange: 'bitmex',
    symbols: ['XBTUSD'],
    from: '2019-08-01',
    to: '2019-08-02'
  },
  normalizeTrades
)

const realTimeMessages = streamNormalized(
  {
    exchange: 'bitmex',
    symbols: ['XBTUSD']
  },
  normalizeTrades
)

async function produceVolumeBasedTradeBars(messages) {
  // aggregate by 50k contracts volume
  const withVolumeTradeBars = compute(messages, computeTradeBars({ kind: 'volume', interval: 50 * 1000 }))

  for await (const message of withVolumeTradeBars) {
    if (message.type === 'trade_bar') {
      console.log(message.name, message)
    }
  }
}

await produceVolumeBasedTradeBars(historicalMessages)

// or for real time data
//  await produceVolumeBasedTradeBars(realTimeMessages)
