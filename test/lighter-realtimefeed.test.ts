import { test } from 'node:test'
import { assert, errorMessageIncludes } from './assertions.ts'
import { LighterRealTimeFeed } from '../dist/realtimefeeds/lighter.js'
import { getRealTimeFeedFactory } from '../dist/realtimefeeds/index.js'
import type { Filter } from '../dist/types.js'

class TestLighterRealTimeFeed extends LighterRealTimeFeed {
  defaultURL() {
    return this.wssURL
  }

  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }
}

test('register lighter realtime feed', () => {
  assert.ok(getRealTimeFeedFactory('lighter'))
})

test('use the correct lighter realtime endpoint', () => {
  const feed = new TestLighterRealTimeFeed('lighter', [], undefined)

  assert.strictEqual(feed.defaultURL(), 'wss://mainnet.zklighter.elliot.ai/stream')
})

test('map lighter realtime subscriptions', () => {
  const expected = [
    { type: 'subscribe', channel: 'order_book/0' },
    { type: 'subscribe', channel: 'trade/0' },
    { type: 'subscribe', channel: 'ticker/0' },
    { type: 'subscribe', channel: 'market_stats/all' },
    { type: 'subscribe', channel: 'spot_market_stats/all' }
  ]
  const filters = [
    { channel: 'order_book', symbols: ['0'] },
    { channel: 'trade', symbols: ['0'] },
    { channel: 'ticker', symbols: ['0'] },
    { channel: 'market_stats' },
    { channel: 'spot_market_stats' }
  ]

  assert.deepStrictEqual(new TestLighterRealTimeFeed('lighter', [], undefined).map(filters), expected)
})

test('lighter realtime subscriptions require symbols for per-market channels', () => {
  const feed = new TestLighterRealTimeFeed('lighter', [], undefined)

  assert.throws(
    () => feed.map([{ channel: 'order_book' }]),
    errorMessageIncludes('lighter RealTimeFeed requires explicitly specified symbols when subscribing to live feed')
  )
})
