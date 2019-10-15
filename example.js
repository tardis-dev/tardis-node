const { Tardis, combine } = require('tardis-node')
const tardis = new Tardis()

async function replayCombined() {
  const bitmexMessages = tardis.replayNormalized({
    exchange: 'bitmex',
    dataTypes: ['trade', 'book_change'],
    symbols: ['XBTUSD'],
    from: '2019-05-01',
    to: '2019-05-01 03:00'
  })

  const deribitMessages = tardis.replayNormalized({
    exchange: 'deribit',
    dataTypes: ['trade', 'book_change'],
    symbols: ['BTC-PERPETUAL'],
    from: '2019-05-01',
    to: '2019-05-01 03:00'
  })

  const combinedStream = combine(bitmexMessages, deribitMessages)

  for await (const message of combinedStream) {
    console.log(message)
  }
}

await replayCombined()
