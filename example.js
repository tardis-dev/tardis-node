const { TardisClient } = require('tardis-client')
const tardisClient = new TardisClient(/* { apiKey: '<OPTIONALLY>' } */)

async function bitmexLiquidationsSample() {
  const bitmexLiquidationsMessages = tardisClient.replay({
    exchange: 'bitmex',
    from: '2019-05-01',
    to: '2019-05-02',
    filters: [{ channel: 'liquidation', symbols: ['XBTUSD'] }]
  })

  const liquidations = []
  for await (let { message, localTimestamp } of bitmexLiquidationsMessages) {
    liquidations.push(
      ...message.data.map(liquidation => ({
        side: liquidation.side,
        action: message.action,
        localTimestamp: localTimestamp.toISOString(),
        size: liquidation.leavesQty
      }))
    )
  }

  return liquidations
}

await bitmexLiquidationsSample()
