# tardis-client

[![Version](https://img.shields.io/npm/v/tardis-client.svg)](https://www.npmjs.org/package/tardis-client)
[![Try on RunKit](https://badge.runkitcdn.com/tardis-client.svg)](https://runkit.com/npm/tardis-client)

A Node.js client for [tardis.dev](https://tardis.dev) - historical tick-level cryptocurrency market data replay API.

Provides fast easy to use wrapper for more level [REST API](https://docs.tardis.dev/api#http-api) with local file based caching build in.

## Installation

Requires Node.js v12 installed.

```sh
npm install tardis-client
```

## Usage

```js
const { TardisClient } = require('tardis-client')
const tardisClient = new TardisClient()

// replay method returns async iterator
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of

const bitmexDataFeedMessages = tardisClient.replay({
  exchange: 'bitmex',
  from: '2019-05-01',
  to: '2019-05-02',
  filters: [
    {
      channel: 'trade',
      symbols: ['XBTUSD', 'ETHUSD']
    },
    {
      channel: 'orderBookL2',
      symbols: ['XBTUSD']
    }
  ]
})

// this will return all trades and orderBookL2 messages for XBTUSD
// and all trades for ETHUSD for bitmex exchange
// between 2019-05-01T00:00:00.000Z and 2019-05-02T00:00:00.000Z (whole first day of May 2019)
for await (let { message, localTimestamp } of bitmexDataFeedMessages) {
  console.log(localTimestamp, message)

  // local timestamp is a JS Date (UTC) that marks timestamp when given message has been received
  // message is a message object as provided by exchange data feed
}
```

## API

`tardis-client` exports single `TardisClient` class.

```js
const { TardisClient } = require('tardis-client')
```

### TardisClient

Optional client constructor options

| name                  | type                  | default value               | description                                                                                                                                                     |
| --------------------- | --------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey` (optional)   | `string or undefined` | `undefined`                 | optional `string` containing API key for [tardis.dev](https://tardis.dev) API. If not provided only first day of each month of data is accessible (free access) |
| `cacheDir` (optional) | `string`              | `<os.tmpdir>/.tardis-cache` | optional `string` with path to local dir that will be used as cache location. If not provided default `temp` dir for given OS isused                            |

Example:

```js
new TardisClient() // creates new client instance with access only to sample data (first day of each month)
new TardisClient({ apiKey: 'YOUR_API_KEY' }) // creates new client with access to all data for given API key
new TardisClient({ cacheDir: './cache' }) // creates new client with custom cache dir
```

- ### `tardisClient.clearCache()`

  Clears local file cache - it's an async function.

  Example:

  ```js
  const tardisClient = new TardisClient()
  await tardisClient.clearCache()
  ```

- ### `tardisClient.replay(ReplayOptions)`

  Replays data feed for given replay options as [async iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of).

  Returns iterator of `{ localTimestamp: Date; message: object }` type.

  - `localTimestamp` is a date when message has been received in ISO 8601 format with 100 nano second resolution.

  - `message` is and JSON object/array with exactly the same structure as provided by particular exchange.

#### ReplayOptions

| name                 | type                                     | default value | description                                                                                                                                                  |
| -------------------- | ---------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `exchange`           | `string`                                 | -             | requested exchange name. Check out [allowed echanges](https://github.com/tardis-dev/node-client/blob/master/src/consts.ts)                                   |
| `from`               | `string`                                 | -             | requested UTC start date of data feed - (eg: `2019-04-05` or `2019-05-05T00:00:00.000Z`)                                                                     |
| `to`                 | `string`                                 | -             | requested UTC end date of data feed - (eg: `2019-04-05` or `2019-05-05T00:00:00.000Z`)                                                                       |
| `filters` (optional) | `{channel:string, symbols?: string[]}[]` | undefined     | optional filters of requested data feed.  Use [/exchanges/:/exchange](https://docs.tardis.dev/api#exchanges-exchange) API call to get allowed channel names and symbols for requested exchange |

Examples:

```js
const tardisClient = new TardisClient({ apiKey: 'YOUR_API_KEY' })

// replay returns async iterator
//  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of

const coinbaseBTCTradesInMay = tardisClient.replay({
  exchange: 'coinbase',
  from: '2019-05-01',
  to: '2019-06-01',
  filters: [
    {
      channel: 'match',
      symbols: ['BTC-USD']
    }
  ]
})

for await (let { message, localTimestamp } of coinbaseBTCTradesInMay) {

}

const bimtexPerpTradesAndOrderBookUpdatesInApril = tardisClient.replay({
  exchange: 'bitmex',
  from: '2019-04-01',
  to: '2019-05-01',
  filters: [
    {
      channel: 'trade',
      symbols: ['XBTUSD','ETHUSD']
    },
    {
      channel: 'orderBookL2',
      symbols: ['XBTUSD','ETHUSD']
    }
  ]
})

for await (let { message, localTimestamp } of bimtexPerpTradesAndOrderBookUpdatesInApril) {

}

const wholeDeribitExchangeDataFeedInFirstOfMay = tardisClient.replay({
  exchange: 'deribit',
  from: '2019-05-01',
  to: '2019-05-02'
})

for await (let { message, localTimestamp } of wholeDeribitExchangeDataFeedInFirstOfMay) {

}
```

- ### `tardisClient.ReplayRaw(ReplayOptions)`

  Replays data feed for given replay options as [async iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of).

  Accepts the same options as `replay` method.

  Returns iterator of `{ localTimestamp: Buffer; message: Buffer }` type, it's faster than `replay` (no decoding to objects/dates, just raw buffers), but may manual decoding from buffers depending on the use case.

  Example:

  ```js

  const rawDeribitDataFeedMessages = tardisClient.replayRaw({
    exchange: 'deribit',
    from: '2019-05-01',
    to: '2019-05-02'
  })

  for await (let { message, localTimestamp } of rawDeribitDataFeedMessages) {
    // here message and localtimestamps are Node.js buffers
  }

  ```

## FAQ

#### How to debug it if something went wrong?

This lib uses [debug](https://github.com/visionmedia/debug) package for verbose logging and debugging purposes that can be enabled via `DEBUG` environment variable set to `tardis-client`.

#### Where can I find more details about tardis.dev API?
Check out [API docs](https://docs.tardis.dev/api).

## License

MPL-2.0
