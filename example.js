const { tardis, normalizeTrades, compute, computeTradeBars } = require('tardis-node')

async function produceVolumeBasedTradeBars(messages) {
  const withVolumeTradeBars = compute(
    messages,
    computeTradeBars({
      kind: 'volume',
      interval: 100 * 1000 // aggregate by 100k contracts volume
    })
  )

  for await (const message of withVolumeTradeBars) {
    if (message.type === 'trade_bar') {
      console.log(message.name, message)
    }
  }
}

const historicalMessages = tardis.replayNormalized(
  { exchange: 'bitmex', symbols: ['XBTUSD'], from: '2019-08-01', to: '2019-08-02' },
  normalizeTrades
)

const realTimeMessages = tardis.streamNormalized(
  { exchange: 'bitmex', symbols: ['XBTUSD'] },
  normalizeTrades
)

await produceVolumeBasedTradeBars(historicalMessages)

// or for real time data
//  await produceVolumeBasedTradeBars(realTimeMessages)
