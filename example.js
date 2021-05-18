process.env.DEBUG = 'tardis-dev*'
const {
  replayNormalized,
  streamNormalized,
  normalizeBookChanges,
  normalizeOptionsSummary,
  compute,
  computeBookSnapshots,
  stream
} = require('./dist')

const realTimeMessages = streamNormalized(
  {
    exchange: 'binance-options',
    symbols: ['BTC-210521-44000-C']
  },
  normalizeOptionsSummary
)

async function produceVolumeBasedTradeBars(messages) {
  // aggregate by 50k contracts volume;
  //const withVolumeTradeBars = compute(realTimeMessages, computeBookSnapshots({ depth: 2, interval: 0 }))

  for await (const message of realTimeMessages) {
    console.log(message)
  }
}

produceVolumeBasedTradeBars()
