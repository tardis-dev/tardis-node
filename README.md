# tardis-node

[![Version](https://img.shields.io/npm/v/tardis-node.svg)](https://www.npmjs.org/package/tardis-node)
[![Try on RunKit](https://badge.runkitcdn.com/tardis-node.svg)](https://runkit.com/npm/tardis-node)


`Tardis-node` library provides convenient access to tick-level historical and real-time cryptocurrency market data both in exchange native and normalized formats. Instead of using callbacks it uses [`async iterables`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) that can be iterated via [`for await ...of`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) loop and that enables composability features like [seamless switching between real-time data streaming and historical data replay](node-js.md#seamless-switching-between-real-time-streaming-and-historical-market-data-replay) or [computing derived data locally](node-js.md#computing-derived-data-locally).
<br/>
<br/>
<br/>

```javascript
const { tardis, normalizeTrades, normalizeBookChanges } = require('tardis-node')

const messages = tardis.streamNormalized(
  {
    exchange: 'bitmex',
    symbols: ['XBTUSD', 'ETHUSD']
  },
  normalizeTrades,
  normalizeBookChanges
)

for await (const message of messages) {
  console.log(message)
}
```

[![Try this code live on RunKit](https://img.shields.io/badge/-Try%20this%20code%20live%20on%20RunKit-c?color=5558be)](https://runkit.com/thad/tardis-node-stream-real-time-market-data)

<br/>

[![Try this code live on RunKit](https://img.shields.io/badge/-Try%20this%20code%20live%20on%20RunKit-b?color=5558be)](https://runkit.com/thad/tardis-node-replay-market-data-normalized)


<br/>
<br/>
<br/>

## Features

- [real-time streaming](node-js.md#tardis-streamnormalized-options-normalizers) of tick-level market data with unified API for connecting directly to exchanges public WebSocket APIs without any intermediary/3rd party proxy
- historical tick-level [market data replay](node-js.md#tardis-replaynormalized-options-normalizers) backed by [tardis.dev HTTP API](http.md#data-feeds-exchange)
- support for both exchange native and [normalized market data](node-js.md#data-normalization) formats \(consistent format for accessing market data across multiple exchanges — normalized trades, order book and ticker data\)
- [seamless switching between real-time streaming and historical market data replay](node-js.md#seamless-switching-between-real-time-streaming-and-historical-market-data-replay) thanks to [`async iterables`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) providing unified way of consuming data messages
- transparent historical local data caching \(cached data is stored on disk in compressed GZIP format and decompressed on demand when reading the data\)
- support for top cryptocurrency exchanges: BitMEX, Binance, Binance Futures, Deribit, Bitfinex, bitFlyer, Bitstamp, Coinbase Pro, Crypto Facilities, Gemini, FTX, Kraken and OKEx.
- automatic closed connections and stale connections reconnection logic for real-time streams
- [combining multiple exchanges feeds into single one](node-js.md#combining-data-streams) via [`combine`](node-js.md#combine-iterators) helper function — synchronized historical market data replay and consolidated real-time data streaming from multiple exchanges
- [computing derived data locally](node-js.md#computing-derived-data-locally) like trade bars and book snapshots via [`compute`](node-js.md#compute-iterator-computables) helper function and `computables`, e.g., volume based bars, top 20 levels order book snapshots taken every 10 ms etc.
- [full limit order book reconstruction](node-js.md#limit-order-book-reconstruction) both for real-time and historical data via `OrderBook` object
- fast and lightweight architecture — low memory footprint and no heavy in-memory buffering
- [extensible mapping logic](node-js.md#modifying-built-in-and-adding-custom-normalizers) that allows adjusting normalized formats for specific needs
- built-in TypeScript support

<br/>
<br/>
<br/>

## Installation

Requires Node.js v12+ installed.

```bash
npm install tardis-node --save
```

<br/>
<br/>
<br/>

## Debugging and logging

`tardis-node` lib uses [debug](https://github.com/visionmedia/debug) package for verbose logging and debugging purposes that can be enabled via `DEBUG` environment variable set to `tardis-node*`.

<br/>
<br/>
<br/>

## Documentation

See the official [tardis-node docs](https://docs.tardis.dev/api/tardis-node).

<br/>
<br/>
<br/>

## Examples


### Seamless switching between real-time streaming and historical market data replay

Example showing simple pattern of providing `async iterable` of market data messages to the function that process them  no matter if it's is real-time or historical market data. This allows having the same logic for example for both back-testing and live trading.

```javascript
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
```

[![Try this code live on RunKit](https://img.shields.io/badge/-Try%20this%20code%20live%20on%20RunKit-c?color=5558be)](https://runkit.com/thad/tardis-node-seamless-switching-between-real-time-streaming-and-historical-market-data-replay)

### Stream real-time market data in exchange native data format

```javascript
const messages = tardis.stream({
  exchange: 'bitmex',
  filters: [
    { channel: 'trade', symbols: ['XBTUSD'] },
    { channel: 'orderBookL2', symbols: ['XBTUSD'] }
  ]
})

for await (const message of messages) {
  console.log(message)
}
```

[![Try this code live on RunKit](https://img.shields.io/badge/-Try%20this%20code%20live%20on%20RunKit-b?color=5558be)](https://runkit.com/thad/tardis-node-stream-market-data)



### Replay historical market data in exchange native data format

```javascript
const messages = tardis.replay({
  exchange: 'bitmex',
  filters: [
    { channel: 'trade', symbols: ['XBTUSD'] },
    { channel: 'orderBookL2', symbols: ['XBTUSD'] }
  ],
  from: '2019-05-01',
  to: '2019-05-02'
})

for await (const message of messages) {
  console.log(message)
}
```

[![Try this code live on RunKit](https://img.shields.io/badge/-Try%20this%20code%20live%20on%20RunKit-b?color=5558be)](https://runkit.com/thad/tardis-node-replay-market-data)
```


### Real-time spread across multiple exchanges

Example showing how to quickly display real-time spread and best bid/ask info across multiple exchanges at once. It can be easily adapted to do the same for historical data \([`replayNormalized`](node-js.md#tardis-replaynormalized-options-normalizers) instead of [`streamNormalized`](node-js.md#tardis-streamnormalized-options-normalizers)\).

```javascript
const { tardis, normalizeBookChanges, combine, compute, 
computeBookSnapshots } = require('tardis-node')

const exchangesToStream = [
  { exchange: 'bitmex', symbols: ['XBTUSD'] },
  { exchange: 'deribit', symbols: ['BTC-PERPETUAL'] },
  { exchange: 'cryptofacilities', symbols: ['PI_XBTUSD'] }
]
// for each specified exchange call streamNormalized for it
// so we have multiple real-time streams for all specified exchanges
const realTimeStreams = exchangesToStream.map(e => {
  return tardis.streamNormalized(e, normalizeBookChanges)
})

// combine all real-time message streams into one
const messages = combine(...realTimeStreams)

// create book snapshots with depth1 that are produced
// every time best bid/ask info is changed
// effectively computing real-time quotes
const realTimeQuoteComputable = computeBookSnapshots({
  depth: 1,
  interval: 0,
  name: 'realtime_quote'
})

// compute real-time quotes for combines real-time messages
const messagesWithQuotes = compute(messages, realTimeQuoteComputable)

const spreads = {}

// print spreads info every 100ms
setInterval(() => {
  console.clear()
  console.log(spreads)
}, 100)

// update spreads info real-time
for await (const message of messagesWithQuotes) {
  if (message.type === 'book_snapshot') {
    spreads[message.exchange] = {
      spread: message.asks[0].price - message.bids[0].price,
      bestBid: message.bids[0],
      bestAsk: message.asks[0]
    }
  }
}
```

[![Try this code live on RunKit](https://img.shields.io/badge/-Try%20this%20code%20live%20on%20RunKit-c?color=5558be)](https://runkit.com/thad/tardis-node-real-time-spread-for-multiple-exchanges)


### See the [tardis-node docs](https://docs.tardis.dev/api/tardis-node).
