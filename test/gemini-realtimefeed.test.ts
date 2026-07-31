import { Filter } from '../src/types.ts'
import { GeminiRealTimeFeed } from '../src/realtimefeeds/gemini.ts'
import { getRealTimeFeedFactory } from '../src/realtimefeeds/index.ts'

class TestGeminiRealTimeFeed extends GeminiRealTimeFeed {
  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }

  isError(message: any) {
    return this.messageIsError(message)
  }
}

test('register gemini realtime feed', () => {
  expect(getRealTimeFeedFactory('gemini')).toBeDefined()
})

test('map gemini v3 realtime subscriptions', () => {
  const feed = new TestGeminiRealTimeFeed('gemini', [], undefined)

  expect(
    feed.map([
      { channel: 'trade', symbols: ['btcusd', 'ETHUSD'] },
      { channel: 'depth', symbols: ['BTCUSD'] },
      { channel: 'bookTicker', symbols: ['btcusd'] }
    ])
  ).toEqual([
    {
      method: 'SUBSCRIBE',
      params: ['btcusd@trade', 'ethusd@trade', 'btcusd@depth@100ms', 'btcusd@bookTicker'],
      id: 1
    }
  ])
})

test('gemini realtime subscriptions require symbols', () => {
  const feed = new TestGeminiRealTimeFeed('gemini', [], undefined)

  expect(() => feed.map([{ channel: 'trade' }])).toThrow(
    'GeminiRealTimeFeed requires explicitly specified symbols when subscribing to live feed'
  )
  expect(() => feed.map([{ channel: 'trade', symbols: 'btcusd' as any }])).toThrow(
    'GeminiRealTimeFeed requires explicitly specified symbols when subscribing to live feed'
  )
})

test('gemini realtime rejects unsupported channels', () => {
  const feed = new TestGeminiRealTimeFeed('gemini', [], undefined)

  expect(() => feed.map([{ channel: 'l2_updates', symbols: ['BTCUSD'] }])).toThrow('GeminiRealTimeFeed unsupported channel l2_updates')
})

test('classify gemini realtime errors', () => {
  const feed = new TestGeminiRealTimeFeed('gemini', [], undefined)

  expect(feed.isError({ result: 'success' })).toBe(false)
  expect(feed.isError({ result: 'error' })).toBe(true)
  expect(feed.isError({ error: 'invalid stream' })).toBe(true)
  expect(feed.isError({ status: 400, error: 'bad request' })).toBe(true)
})
