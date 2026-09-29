import { test } from 'node:test'
import { assert } from './assertions.ts'
import { BybitSpreadRealTimeDataFeed } from '../dist/realtimefeeds/bybit.js'
import { getRealTimeFeedFactory } from '../dist/realtimefeeds/index.js'
import type { Filter } from '../dist/types.js'

class TestBybitSpreadFeed extends BybitSpreadRealTimeDataFeed {
  get url() {
    return this.wssURL
  }

  subscriptions(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }
}

test('Bybit spread subscribes to full symbols on the spread endpoint', () => {
  assert.equal(getRealTimeFeedFactory('bybit-spread'), BybitSpreadRealTimeDataFeed)
  const feed = new TestBybitSpreadFeed('bybit-spread', [], undefined)
  assert.equal(feed.url, 'wss://stream.bybit.com/v5/public/spread')
  assert.deepEqual(
    feed.subscriptions([
      { channel: 'orderbook.25', symbols: ['BTCUSDT_BTC/USDT'] },
      { channel: 'publicTrade', symbols: ['BTCUSDT-26MAR27_BTCUSDT-25DEC26'] },
      { channel: 'tickers', symbols: ['ETHUSDT_ETH/USDT'] }
    ]),
    [
      {
        op: 'subscribe',
        args: ['orderbook.25.BTCUSDT_BTC/USDT', 'publicTrade.BTCUSDT-26MAR27_BTCUSDT-25DEC26', 'tickers.ETHUSDT_ETH/USDT']
      }
    ]
  )
  assert.throws(() => feed.subscriptions([{ channel: 'publicTrade' }]), /explicitly specified symbols/)
})
