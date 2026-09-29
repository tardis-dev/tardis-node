import { test } from 'node:test'
import { assert, errorMessageIncludes } from './assertions.ts'
import { LighterRhRealTimeFeed } from '../dist/realtimefeeds/lighter.js'
import { getRealTimeFeedFactory } from '../dist/realtimefeeds/index.js'
import type { Filter } from '../dist/types.js'

class TestLighterRhRealTimeFeed extends LighterRhRealTimeFeed {
  defaultURL() {
    return this.wssURL
  }

  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }
}

test('register lighter RH realtime feed', () => {
  assert.ok(getRealTimeFeedFactory('lighter-rh'))
})

test('use the correct lighter RH realtime endpoint', () => {
  const feed = new TestLighterRhRealTimeFeed('lighter-rh', [], undefined)

  assert.strictEqual(feed.defaultURL(), 'wss://api.rh.lighter.xyz/stream')
})

test('map lighter RH realtime subscriptions', () => {
  const feed = new TestLighterRhRealTimeFeed('lighter-rh', [], undefined)

  assert.deepStrictEqual(
    feed.map([
      { channel: 'order_book', symbols: ['0'] },
      { channel: 'trade', symbols: ['0'] },
      { channel: 'ticker', symbols: ['0'] },
      { channel: 'market_stats' },
      { channel: 'spot_market_stats' }
    ]),
    [
      { type: 'subscribe', channel: 'order_book/0' },
      { type: 'subscribe', channel: 'trade/0' },
      { type: 'subscribe', channel: 'ticker/0' },
      { type: 'subscribe', channel: 'market_stats/all' },
      { type: 'subscribe', channel: 'spot_market_stats/all' }
    ]
  )
})

test('lighter RH realtime subscriptions require symbols for per-market channels', () => {
  const feed = new TestLighterRhRealTimeFeed('lighter-rh', [], undefined)

  assert.throws(
    () => feed.map([{ channel: 'order_book' }]),
    errorMessageIncludes('lighter-rh RealTimeFeed requires explicitly specified symbols when subscribing to live feed')
  )
})
