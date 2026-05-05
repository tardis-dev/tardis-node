# tardis-dev

[![Version](https://img.shields.io/npm/v/tardis-dev.svg)](https://www.npmjs.org/package/tardis-dev)

<br/>

Node.js `tardis-dev` library provides convenient access to tick-level real-time and historical cryptocurrency market data both in exchange native and normalized formats. Instead of callbacks it relies on [async iteration (for await ...of)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) enabling composability features like [seamless switching between real-time data streaming and historical data replay](https://docs.tardis.dev/node-client/normalization#seamless-switching-between-real-time-streaming-and-historical-market-data-replay) or [computing derived data locally](https://docs.tardis.dev/node-client/normalization#computing-derived-data-locally).

<br/>

```javascript
import { replayNormalized, normalizeTrades, normalizeBookChanges } from 'tardis-dev'

const messages = replayNormalized(
  {
    exchange: 'binance',
    symbols: ['btcusdt'],
    from: '2024-03-01',
    to: '2024-03-02'
  },
  normalizeTrades,
  normalizeBookChanges
)

for await (const message of messages) {
  console.log(message)
}
```

<br/>

## Features

- historical tick-level [market data replay](https://docs.tardis.dev/node-client/replaying-historical-data) backed by [tardis.dev HTTP API](https://docs.tardis.dev/api/http-api-reference#data-feeds-exchange) — includes full order book depth snapshots plus incremental updates, tick-by-tick trades, historical open interest, funding, index, mark prices, liquidations and more

  <br/>

- consolidated [real-time data streaming API](https://docs.tardis.dev/node-client/streaming-real-time-data) connecting directly to exchanges' public WebSocket APIs

<br/>

- support for both [exchange-native and normalized market data](https://docs.tardis.dev/faq/data) formats (unified format for accessing market data across all supported exchanges — normalized trades, order book and ticker data)

<br/>

- [seamless switching between real-time streaming and historical market data replay](https://docs.tardis.dev/node-client/normalization#seamless-switching-between-real-time-streaming-and-historical-market-data-replay) thanks to [`async iterables`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) providing unified way of consuming data messages

<br/>

- transparent historical local data caching \(cached data is stored on disk per slice in compressed format and decompressed on demand when reading the data\)

<br/>

- support for many cryptocurrency exchanges — see [docs.tardis.dev](https://docs.tardis.dev) for the full list

<br/>

- automatic closed connections and stale connections reconnection logic for real-time streams

<br/>

- [combining multiple exchanges feeds into single one](https://docs.tardis.dev/node-client/normalization#combining-data-streams) via [`combine`](https://docs.tardis.dev/node-client/normalization#combining-data-streams) helper function — synchronized historical market data replay and consolidated real-time data streaming from multiple exchanges

<br/>

- [computing derived data locally](https://docs.tardis.dev/node-client/normalization#computing-derived-data-locally) like order book imbalance, custom trade bars, book snapshots and more via [`compute`](https://docs.tardis.dev/node-client/normalization#computing-derived-data-locally) helper function and `computables`, e.g., volume based bars, top 20 levels order book snapshots taken every 10 ms etc.

<br/>

- [full limit order book reconstruction](https://docs.tardis.dev/node-client/normalization#limit-order-book-reconstruction) both for real-time and historical data via `OrderBook` object

<br/>

- fast and lightweight architecture — low memory footprint and no heavy in-memory buffering

<br/>

- [extensible mapping logic](https://docs.tardis.dev/node-client/normalization#modifying-built-in-and-adding-custom-normalizers) that allows adjusting normalized formats for specific needs

<br/>

- [built-in TypeScript support](https://docs.tardis.dev/node-client/quickstart#es-modules-and-typescript)

<br/>
<br/>
<br/>

## Installation

Requires Node.js v25+ installed.

```bash
npm install tardis-dev --save
```

`tardis-dev` is ESM-only. Examples in this README use ES modules and top-level await. Save snippets as `.mjs` or set `"type": "module"` in your `package.json`.

<br/>
<br/>

## Documentation

### [See official docs](https://docs.tardis.dev/node-client/quickstart).

<br/>
<br/>

## Examples

### Real-time spread across multiple exchanges

Example showing how to quickly display real-time spread and best bid/ask info across multiple exchanges at once. It can be easily adapted to do the same for historical data \(`replayNormalized` instead of `streamNormalized`).

```javascript
import { streamNormalized, normalizeBookChanges, combine, compute, computeBookSnapshots } from 'tardis-dev'

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

<br/>

### Seamless switching between real-time streaming and historical market data replay

Example showing simple pattern of providing `async iterable` of market data messages to the function that can process them no matter if it's is real-time or historical market data. That effectively enables having the same 'data pipeline' for backtesting and live trading.

```javascript
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
  const withVolumeTradeBars = compute(
    messages,
    computeTradeBars({
      kind: 'volume',
      interval: 1 // aggregate by 1 BTC traded volume
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

<br/>

### Stream real-time market data in exchange native data format

```javascript
import { stream } from 'tardis-dev'

const messages = stream({
  exchange: 'binance',
  filters: [
    { channel: 'trade', symbols: ['btcusdt'] },
    { channel: 'depth', symbols: ['btcusdt'] }
  ]
})

for await (const { localTimestamp, message } of messages) {
  console.log(localTimestamp, message)
}
```

<br/>

### Replay historical market data in exchange native data format

```javascript
import { replay } from 'tardis-dev'

const messages = replay({
  exchange: 'binance',
  filters: [
    { channel: 'trade', symbols: ['btcusdt'] },
    { channel: 'depth', symbols: ['btcusdt'] }
  ],
  from: '2024-03-01',
  to: '2024-03-02'
})

for await (const { localTimestamp, message } of messages) {
  console.log(localTimestamp, message)
}
```

<br/>
<br/>

## See the [tardis-dev docs](https://docs.tardis.dev/node-client/quickstart) for more examples.
