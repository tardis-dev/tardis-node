import { test } from 'node:test'
import { assert } from './assertions.ts'
import type { Filter } from '../dist/types.js'
import { HyperliquidRealTimeFeed } from '../dist/realtimefeeds/hyperliquid.js'

class TestHyperliquidRealTimeFeed extends HyperliquidRealTimeFeed {
  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }
}

test('maps fastBook to the Hyperliquid fast l2Book subscription', () => {
  const feed = new TestHyperliquidRealTimeFeed('hyperliquid', [], undefined)

  assert.deepStrictEqual(feed.map([{ channel: 'fastBook', symbols: ['BTC'] }]), [
    {
      method: 'subscribe',
      subscription: { coin: 'BTC', type: 'l2Book', fast: true }
    }
  ])
})
