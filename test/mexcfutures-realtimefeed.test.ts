import { Filter } from '../src/types.ts'
import { MexcFuturesRealTimeFeed } from '../src/realtimefeeds/mexcfutures.ts'

class TestMexcFuturesRealTimeFeed extends MexcFuturesRealTimeFeed {
  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }
}

test('map mexc futures stored push channels to subscription methods', () => {
  const feed = new TestMexcFuturesRealTimeFeed('mexc-futures', [], undefined)

  expect(
    feed.map([
      {
        channel: 'push.deal',
        symbols: ['BTC_USDT', 'ETH_USDT']
      },
      {
        channel: 'push.depth',
        symbols: ['BTC_USDT']
      },
      {
        channel: 'push.funding.rate',
        symbols: ['BTC_USDT']
      },
      {
        channel: 'push.contract'
      }
    ])
  ).toEqual([
    {
      method: 'sub.deal',
      param: { symbol: 'BTC_USDT' },
      gzip: false
    },
    {
      method: 'sub.deal',
      param: { symbol: 'ETH_USDT' },
      gzip: false
    },
    {
      method: 'sub.depth',
      param: { symbol: 'BTC_USDT' },
      gzip: false
    },
    {
      method: 'sub.funding.rate',
      param: { symbol: 'BTC_USDT' },
      gzip: false
    },
    {
      method: 'sub.contract'
    }
  ])
})

test('mexc futures realtime subscriptions require symbols', () => {
  const feed = new TestMexcFuturesRealTimeFeed('mexc-futures', [], undefined)

  expect(() =>
    feed.map([
      {
        channel: 'push.deal'
      }
    ])
  ).toThrow('MexcFuturesRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
})
