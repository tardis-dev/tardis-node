const { TardisClient } = require('tardis-client');
const tardisClient = new TardisClient(/* { apiKey:'<OPTIONAL>'} */);

async function replay() {
  const liquidations = [];

  const messages = tardisClient.replay({
    exchange: 'bitmex',
    from: '2019-05-01',
    to: '2019-05-01 03:00',
    filters: [{ channel: 'liquidation', symbols: ['XBTUSD'] }]
  });

  for await (let { message, localTimestamp } of messages) {
    liquidations.push(message);
  }
  return liquidations;
}

await replay();
