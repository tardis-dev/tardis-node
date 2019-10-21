# tardis-node

[![Version](https://img.shields.io/npm/v/tardis-node.svg)](https://www.npmjs.org/package/tardis-node)
[![Try on RunKit](https://badge.runkitcdn.com/tardis-node.svg)](https://runkit.com/npm/tardis-node)

Tardis Node library provides fast and convenient access to tick-level real-time and historical cryptocurrency market data.

Built-in support for:

- real-time streaming market data with unified interface for connecting to public exchanges WebSocket APIs
- historical market data replay backed by [tardis.dev](https://tardis.dev) API
- both exchange native and normalized\* market data format
- top cryptocurrency exchanges
- automatic reconnection and stale connections detection logic for real-time streams
- combining multiple exchanges feeds into single one
- computing custom trade bins/bars and book snapshots client-side (eg: volume based bars, top 20 levels 100ms order book snapshots etc.)
- full limit order book reconstruction, both for real-time and historical data
- built-in TypeScript support

\* normalized: consistent format for accessing market data across multiple exchanges -normalized trade, order book L2 and ticker data

## Installation

Requires Node.js v12+ installed.

```sh
npm install tardis-node --save
```

## Documentation

See the [tardis-node docs](https://docs.tardis.dev/api/tardis-node).

## Usage

### Stream real-time market data in exchange native data format

```js
const { tardis } = require('tardis-node')

async function stream() {
  const messages = tardis.stream({
    exchange: 'bitmex',
    filters: [{ channel: 'trade', symbols: ['XBTUSD'] }, { channel: 'orderBookL2', symbols: ['XBTUSD'] }]
  })

  for await (const { message, localTimestamp } of messages) {
    console.log(message)
  }
}

stream()
```

### Replay historical market data in exchange native data format

```js
const { tardis } = require('tardis-node')

async function replay() {
  const messages = tardis.replay({
    exchange: 'bitmex',
    filters: [{ channel: 'trade', symbols: ['XBTUSD'] }, { channel: 'orderBookL2', symbols: ['XBTUSD'] }],
    from: '2019-05-01',
    to: '2019-05-02'
  })

  for await (const { message, localTimestamp } of messages) {
    console.log(message)
  }
}

replay()
```

### Stream real-time market data in normalized data format

```js
const { tardis, normalizeTrades, normalizeBookChanges } = require('tardis-node')

async function streamNormalized() {
  const messages = tardis.streamNormalized(
    {
      exchange: 'bitmex',
      symbols: ['XBTUSD']
    },
    normalizeTrades,
    normalizeBookChanges
  )

  for await (const message of messages) {
    console.log(message)
  }
}

streamNormalized()
```

### Replay historical market data in normalized data format

```js
const { tardis, normalizeTrades, normalizeBookChanges } = require('tardis-node')

async function replayNormalized() {
  const messages = tardis.replayNormalized(
    {
      exchange: 'bitmex',
      symbols: ['XBTUSD'],
      from: '2019-05-01',
      to: '2019-05-02'
    },
    normalizeTrades,
    normalizeBookChanges
  )

  for await (const message of messages) {
    console.log(message)
  }
}

replayNormalized()
```

### Combine two historical exchange market data feeds

Returns single messages 'stream' that is ordered by `localTimestamp`.
It works the same way for real-time market data as well, but messages are returned in FIFO manner.

```js
const { tardis, normalizeTrades, normalizeBookChanges, combine } = require('tardis-node')

async function replayCombined() {
  const bitmexMessages = tardis.replayNormalized(
    {
      exchange: 'bitmex',
      symbols: ['XBTUSD'],
      from: '2019-05-01',
      to: '2019-05-02'
    },
    normalizeTrades,
    normalizeBookChanges
  )

  const deribitMessages = tardis.replayNormalized(
    {
      exchange: 'deribit',
      symbols: ['BTC-PERPETUAL'],
      from: '2019-05-01',
      to: '2019-05-02'
    },
    normalizeTrades,
    normalizeBookChanges
  )

  const combinedStream = combine(bitmexMessages, deribitMessages)

  for await (const message of combinedStream) {
    console.log(message)
  }
}

replayCombined()
```

### Compute 10 seconds trade bins and top 5 levels book snapshots every 2 seconds for real-time market data stream

```js
const { tardis, normalizeTrades, normalizeBookChanges, compute, computeTradeBars, computeBookSnapshots } = require('tardis-node')

async function streamComputed() {
  const bitmexMessages = tardis.streamNormalized(
    {
      exchange: 'bitmex',
      symbols: ['XBTUSD']
    },
    normalizeTrades,
    normalizeBookChanges
  )

  const messagesWithComputedTypes = compute(
    bitmexMessages,
    computeTradeBars({ kind: 'time', interval: 10 * 1000 }),
    computeBookSnapshots({ depth: 5, interval: 2 * 1000 })
  )

  for await (const message of messagesWithComputedTypes) {
    if (message.type === 'book_snapshot' || message.type === 'trade_bar') {
      console.log(message)
    }
  }
}

streamComputed()
```

### Reconstruct historical limit order book at any point in time

It works in the same way for real-time market data.

```js
const { tardis, normalizeTrades, normalizeBookChanges, OrderBook } = require('tardis-node')

async function reconstructLOB() {
  const bitmexXBTMessages = tardis.replayNormalized(
    {
      exchange: 'bitmex',
      symbols: ['XBTUSD'],
      from: '2019-05-01',
      to: '2019-05-02'
    },
    normalizeTrades,
    normalizeBookChanges
  )
  const orderBook = new OrderBook()

  for await (const message of bitmexXBTMessages) {
    if (message.type === 'book_change') {
      orderBook.update(message)
    }
    console.log(message.localTimestamp.toISOString(), orderBook.bestAsk(), orderBook.bestBid())
    // or orderBook.bids(), orderBook.asks() to get all levels at any given point in time
  }
}

reconstructLOB()
```
