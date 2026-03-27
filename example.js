import { replayNormalized, streamNormalized, normalizeTrades, compute, computeTradeBars } from 'tardis-dev'

const historicalMessages = replayNormalized(
  {
    exchange: 'binance',
    symbols: ['btcusdt'],
    from: '2024-03-01',
    to: '2024-03-02'
  },
  normalizeTrades
)

const realTimeMessages = streamNormalized(
  {
    exchange: 'binance',
    symbols: ['btcusdt']
  },
  normalizeTrades
)

async function produceVolumeBasedTradeBars(messages) {
  // aggregate by 1 BTC traded volume
  const withVolumeTradeBars = compute(messages, computeTradeBars({ kind: 'volume', interval: 1 }))

  for await (const message of withVolumeTradeBars) {
    if (message.type === 'trade_bar') {
      console.log(message.name, message)
    }
  }
}

await produceVolumeBasedTradeBars(historicalMessages)

// or for real time data
//  await produceVolumeBasedTradeBars(realTimeMessages)
