# tardis-dev

[![Version](https://img.shields.io/npm/v/tardis-dev.svg)](https://www.npmjs.org/package/tardis-dev)
[![Try on RunKit](https://badge.runkitcdn.com/tardis-dev.svg)](https://runkit.com/npm/tardis-dev)

<br/>

Node.js `tardis-dev` library provides convenient access to tick-level real-time and historical cryptocurrency market data both in exchange native and normalized formats. Instead of callbacks it relies on [async iteration (for await ...of)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) enabling composability features like [seamless switching between real-time data streaming and historical data replay](https://docs.tardis.dev/api/node-js#seamless-switching-between-real-time-streaming-and-historical-market-data-replay) or [computing derived data locally](https://docs.tardis.dev/api/node-js#computing-derived-data-locally).

<br/>

```javascript
const { replayNormalized, normalizeTrades, normalizeBookChanges } = require('tardis-dev')

const messages = replayNormalized(
  {
    exchange: 'bitmex',
    symbols: ['XBTUSD', 'ETHUSD'],
    from: '2019-05-01',
    to: '2019-05-02'
  },
  normalizeTrades,
  normalizeBookChanges
)

for await (const message of messages) {
  console.log(message)
}
```

[![Try this code live on RunKit](https://img.shields.io/badge/-Try%20this%20code%20live%20on%20RunKit-c?color=5558be)](https://runkit.com/thad/tardis-dev-replay-market-data-normalized)

<br/>
<br/>

## Features

- historical tick-level [market data replay](https://docs.tardis.dev/api/node-js#replaying-historical-market-data) backed by [tardis.dev HTTP API](https://docs.tardis.dev/api/http#data-feeds-exchange) — includes full order book depth snapshots plus incremental updates, tick-by-tick trades, historical open interest, funding, index, mark prices, liquidations and more

  <br/>

- consolidated [real-time data streaming API](https://docs.tardis.dev/api/node-js#streaming-real-time-market-data) connecting directly to exchanges' public WebSocket APIs

<br/>

- support for both [exchange-native](https://docs.tardis.dev/faq/data#what-is-a-difference-between-exchange-native-and-normalized-data-format) and [normalized market data](https://docs.tardis.dev/faq/data#what-is-a-difference-between-exchange-native-and-normalized-data-format) formats (unified format for accessing market data across all supported exchanges — normalized trades, order book and ticker data)

<br/>

- [seamless switching between real-time streaming and historical market data replay](https://docs.tardis.dev/api/node-js#seamless-switching-between-real-time-streaming-and-historical-market-data-replay) thanks to [`async iterables`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) providing unified way of consuming data messages

<br/>

- transparent historical local data caching \(cached data is stored on disk in compressed GZIP format and decompressed on demand when reading the data\)

<br/>

- support for top cryptocurrency exchanges: BitMEX, Deribit, Binance, FTX, OKEx, Huobi Futures, Huobi Global, Bitfinex, Coinbase Pro, Kraken Futures, Kraken, Bitstamp, Gemini, Poloniex, Bybit, Phemex, Delta Exchange, FTX US, Binance US, Gate.io, OKCoin, bitFlyer, HitBTC, CoinFLEX (2.0), Binance Jersey and more

<br/>

- automatic closed connections and stale connections reconnection logic for real-time streams

<br/>

- [combining multiple exchanges feeds into single one](https://docs.tardis.dev/api/node-js#combining-data-streams) via [`combine`](https://docs.tardis.dev/api/node-js#combine-iterators) helper function — synchronized historical market data replay and consolidated real-time data streaming from multiple exchanges

<br/>

- [computing derived data locally](https://docs.tardis.dev/api/node-js#computing-derived-data-locally) like order book imbalance, custom trade bars, book snapshots and more via [`compute`](https://docs.tardis.dev/api/node-js#compute-iterator-computables) helper function and `computables`, e.g., volume based bars, top 20 levels order book snapshots taken every 10 ms etc.

<br/>

- [full limit order book reconstruction](https://docs.tardis.dev/api/node-js#limit-order-book-reconstruction) both for real-time and historical data via `OrderBook` object

<br/>

- fast and lightweight architecture — low memory footprint and no heavy in-memory buffering

<br/>

- [extensible mapping logic](https://docs.tardis.dev/api/node-js#modifying-built-in-and-adding-custom-normalizers) that allows adjusting normalized formats for specific needs

<br/>

- [built-in TypeScript support](https://docs.tardis.dev/api/node-js#usage-with-typescript)

<br/>
<br/>
<br/>

## Installation

Requires Node.js v12+ installed.

```bash
npm install tardis-dev --save
```

<br/>
<br/>

## Documentation

### [See official docs](https://docs.tardis.dev/api/node-js).

<br/>
<br/>

## Examples

### Real-time spread across multiple exchanges

Example showing how to quickly display real-time spread and best bid/ask info across multiple exchanges at once. It can be easily adapted to do the same for historical data \(`replayNormalized` instead of `streamNormalized`).

```javascript
const tardis = require('tardis-dev')
const { streamNormalized, normalizeBookChanges, combine, compute, computeBookSnapshots } = tardis

const exchangesToStream = [
  { exchange: 'bitmex', symbols: ['XBTUSD'] },
  { exchange: 'deribit', symbols: ['BTC-PERPETUAL'] },
  { exchange: 'cryptofacilities', symbols: ['PI_XBTUSD'] }
]
// for each specified exchange call streamNormalized for it
// so we have multiple real-time streams for all specified exchanges
const realTimeStreams = exchangesToStream.map((e) => {
  return streamNormalized(e, normalizeBookChanges)
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

[![Try this code live on RunKit](https://img.shields.io/badge/-Try%20this%20code%20live%20on%20RunKit-c?color=5558be)](https://runkit.com/thad/tardis-dev-real-time-spread-for-multiple-exchanges)

<br/>

### Seamless switching between real-time streaming and historical market data replay

Example showing simple pattern of providing `async iterable` of market data messages to the function that can process them no matter if it's is real-time or historical market data. That effectively enables having the same 'data pipeline' for backtesting and live trading.

```javascript
const tardis = require('tardis-dev')
const { replayNormalized, streamNormalized, normalizeTrades, compute, computeTradeBars } = tardis

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

await produceVolumeBasedTradeBars(historicalMessages)

// or for real time data
//  await produceVolumeBasedTradeBars(realTimeMessages)
```

[![Try this code live on RunKit](https://img.shields.io/badge/-Try%20this%20code%20live%20on%20RunKit-c?color=5558be)](https://runkit.com/thad/tardis-dev-seamless-switching-between-real-time-streaming-and-historical-market-data-replay)

<br/>

### Stream real-time market data in exchange native data format

```javascript
const { stream } = require('tardis-dev')

const messages = stream({
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

[![Try this code live on RunKit](https://img.shields.io/badge/-Try%20this%20code%20live%20on%20RunKit-b?color=5558be)](https://runkit.com/thad/tardis-dev-stream-market-data)

<br/>

### Replay historical market data in exchange native data format

```javascript
const { replay } = require('tardis-dev')

const messages = replay({
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

[![Try this code live on RunKit](https://img.shields.io/badge/-Try%20this%20code%20live%20on%20RunKit-b?color=5558be)](https://runkit.com/thad/tardis-dev-replay-market-data)

<br/>
<br/>

## See the [tardis-dev docs](https://docs.tardis.dev/api/node-js) for more examples.
