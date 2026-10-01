import { test } from 'node:test'
import { BybitSpotRealTimeDataFeed } from '../dist/realtimefeeds/bybit.js'
import type { Filter } from '../dist/types.js'
import { assert } from './assertions.ts'

class TestBybitSpotRealTimeFeed extends BybitSpotRealTimeDataFeed {
  subscriptions(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }
}

test('Bybit spot subscribes to mixed channels for multiple symbols', () => {
  const filters = ['publicTrade', 'orderbook.50', 'orderbook.full', 'orderbook.rpi'].map((channel) => ({
    channel,
    symbols: ['BTCUSDT', 'ETHUSDT']
  }))
  const feed = new TestBybitSpotRealTimeFeed('bybit-spot', filters, undefined)
  assert.deepEqual(feed.subscriptions(filters), [
    {
      op: 'subscribe',
      args: [
        'publicTrade.BTCUSDT',
        'publicTrade.ETHUSDT',
        'orderbook.50.BTCUSDT',
        'orderbook.50.ETHUSDT',
        'orderbook.full.BTCUSDT',
        'orderbook.full.ETHUSDT',
        'orderbook.rpi.BTCUSDT',
        'orderbook.rpi.ETHUSDT'
      ]
    }
  ])
})

test('Bybit spot batches subscriptions into at most ten topics without losing or duplicating topics', () => {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT']
  const filters = ['orderbook.full', 'orderbook.rpi'].map((channel) => ({ channel, symbols }))
  const feed = new TestBybitSpotRealTimeFeed('bybit-spot', filters, undefined)
  const requests = feed.subscriptions(filters)

  assert.deepEqual(
    requests.map((request) => request.args.length),
    [10, 2]
  )
  assert.ok(requests.every((request) => request.op === 'subscribe'))
  const topics = requests.flatMap((request) => request.args)
  assert.equal(new Set(topics).size, 12)
  for (const symbol of symbols) {
    assert.ok(topics.includes(`orderbook.full.${symbol}`))
    assert.ok(topics.includes(`orderbook.rpi.${symbol}`))
  }
})

test('Bybit spot subscriptions require explicit nonempty symbols', () => {
  const feed = new TestBybitSpotRealTimeFeed('bybit-spot', [], undefined)
  for (const channel of ['publicTrade', 'orderbook.50', 'orderbook.full', 'orderbook.rpi']) {
    assert.throws(() => feed.subscriptions([{ channel }]), /requires explicitly specified symbols/)
    assert.throws(() => feed.subscriptions([{ channel, symbols: [] }]), /requires explicitly specified symbols/)
  }
})
