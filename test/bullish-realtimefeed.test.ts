import { Filter } from '../src/types.ts'
import { BullishSingleConnectionRealTimeFeed } from '../src/realtimefeeds/bullish.ts'
import { getRealTimeFeedFactory } from '../src/realtimefeeds/index.ts'

class TestBullishSingleConnectionRealTimeFeed extends BullishSingleConnectionRealTimeFeed {
  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }

  isError(message: any) {
    return this.messageIsError(message)
  }

  isHeartbeat(message: any) {
    return this.messageIsHeartbeat(message)
  }
}

test('register bullish realtime feed', () => {
  expect(getRealTimeFeedFactory('bullish')).toBeDefined()
})

test('map bullish realtime market-symbol subscriptions', () => {
  const feed = new TestBullishSingleConnectionRealTimeFeed('bullish', '/trading-api/v1/market-data/orderbook', [], undefined)

  const subscribeMessages = feed.map([
    {
      channel: 'V1TALevel2',
      symbols: ['BTCUSD', 'ETHUSD']
    },
    {
      channel: 'V1TALevel1',
      symbols: ['BTCUSD']
    },
    {
      channel: 'V1TAAnonymousTradeUpdate',
      symbols: ['BTCUSD']
    },
    {
      channel: 'V1TATickerResponse',
      symbols: ['BTCUSD']
    }
  ])

  expect(subscribeMessages).toMatchSnapshot()
})

test('map bullish realtime index price subscription with assetSymbol', () => {
  const feed = new TestBullishSingleConnectionRealTimeFeed('bullish', '/trading-api/v1/index-data', [], undefined)

  const subscribeMessages = feed.map([
    {
      channel: 'V1TAIndexPrice',
      symbols: ['BTC']
    }
  ])

  expect(subscribeMessages).toMatchSnapshot()
})

test('map bullish realtime heartbeat subscription without symbol', () => {
  const feed = new TestBullishSingleConnectionRealTimeFeed('bullish', '/trading-api/v1/market-data/orderbook', [], undefined)

  const subscribeMessages = feed.map([
    {
      channel: 'V1TAHeartbeat'
    }
  ])

  expect(subscribeMessages).toMatchSnapshot()
})

test('bullish realtime market subscriptions require symbols', () => {
  const feed = new TestBullishSingleConnectionRealTimeFeed('bullish', '/trading-api/v1/market-data/orderbook', [], undefined)

  expect(() =>
    feed.map([
      {
        channel: 'V1TALevel2'
      }
    ])
  ).toThrow('BullishRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
})

test('classify bullish realtime control messages', () => {
  const feed = new TestBullishSingleConnectionRealTimeFeed('bullish', '/trading-api/v1/market-data/orderbook', [], undefined)

  expect(
    feed.isError({
      jsonrpc: '2.0',
      error: {
        code: -32602,
        message: 'Invalid params'
      }
    })
  ).toBe(true)

  expect(
    feed.isHeartbeat({
      type: 'update',
      dataType: 'V1TAHeartbeat',
      data: {
        message: 'heartbeat'
      }
    })
  ).toBe(true)

  expect(
    feed.isHeartbeat({
      jsonrpc: '2.0',
      result: {
        message: 'Keep alive pong'
      }
    })
  ).toBe(true)
})
