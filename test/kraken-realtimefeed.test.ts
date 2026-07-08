import { Filter } from '../src/types.ts'
import { KrakenRealTimeFeed } from '../src/realtimefeeds/kraken.ts'
import { getRealTimeFeedFactory } from '../src/realtimefeeds/index.ts'

class TestKrakenRealTimeFeed extends KrakenRealTimeFeed {
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

test('register kraken realtime feed', () => {
  expect(getRealTimeFeedFactory('kraken')).toBeDefined()
})

test('map kraken v2 realtime subscriptions', () => {
  const feed = new TestKrakenRealTimeFeed('kraken', [], undefined)

  const subscribeMessages = feed.map([
    { channel: 'trade', symbols: ['BTC/USD'] },
    { channel: 'book', symbols: ['BTC/USD'] },
    { channel: 'ticker', symbols: ['AAPLx/USD'] }
  ])

  expect(subscribeMessages).toEqual([
    {
      method: 'subscribe',
      params: { channel: 'trade', symbol: ['BTC/USD'] }
    },
    {
      method: 'subscribe',
      params: { channel: 'book', symbol: ['BTC/USD'], depth: 1000 }
    },
    {
      method: 'subscribe',
      params: { channel: 'ticker', symbol: ['AAPLx/USD'], event_trigger: 'bbo' }
    }
  ])
})

test('kraken realtime subscriptions require symbols', () => {
  const feed = new TestKrakenRealTimeFeed('kraken', [], undefined)

  expect(() => feed.map([{ channel: 'trade' }])).toThrow(
    'KrakenRealTimeFeed requires explicitly specified symbols when subscribing to live feed'
  )
})

test('kraken realtime rejects unsupported channels', () => {
  const feed = new TestKrakenRealTimeFeed('kraken', [], undefined)

  expect(() => feed.map([{ channel: 'spread', symbols: ['XBT/USD'] }])).toThrow('KrakenRealTimeFeed unsupported channel spread')
})

test('classify kraken realtime control messages', () => {
  const feed = new TestKrakenRealTimeFeed('kraken', [], undefined)

  expect(feed.isHeartbeat({ event: 'heartbeat' })).toBe(true)
  expect(feed.isHeartbeat({ channel: 'heartbeat' })).toBe(true)
  expect(feed.isError({ method: 'subscribe', success: true })).toBe(false)
  expect(feed.isError({ method: 'subscribe', success: false, error: 'invalid arguments' })).toBe(true)
  expect(feed.isError({ errorMessage: 'Pair field must be an array' })).toBe(true)
})
