import { Filter } from '../src/types.ts'
import { stream } from '../src/stream.ts'
import { PolymarketClobRealTimeFeed, PolymarketSportsRealTimeFeed } from '../src/realtimefeeds/polymarket.ts'
import { getRealTimeFeedFactory } from '../src/realtimefeeds/index.ts'

class TestPolymarketClobRealTimeFeed extends PolymarketClobRealTimeFeed {
  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }

  isError(message: any) {
    return this.messageIsError(message)
  }

  isHeartbeat(message: any) {
    return this.messageIsHeartbeat(message)
  }

  decompressMessage(message: Buffer) {
    return this.decompress(message)
  }
}

class TestPolymarketSportsRealTimeFeed extends PolymarketSportsRealTimeFeed {
  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }

  isError(message: any) {
    return this.messageIsError(message)
  }

  isHeartbeat(message: any) {
    return this.messageIsHeartbeat(message)
  }

  decompressMessage(message: Buffer) {
    return this.decompress(message)
  }
}

test('register polymarket realtime feed', () => {
  expect(getRealTimeFeedFactory('polymarket')).toBeDefined()
})

test('map polymarket clob realtime subscription', () => {
  const feed = new TestPolymarketClobRealTimeFeed('polymarket', [], undefined)

  const subscribeMessages = feed.map([
    {
      channel: 'book',
      symbols: ['123', '456']
    },
    {
      channel: 'price_change',
      symbols: ['123']
    },
    {
      channel: 'last_trade_price',
      symbols: ['789']
    }
  ])

  expect(subscribeMessages).toMatchSnapshot()
})

test('polymarket clob realtime subscriptions require symbols', async () => {
  await expect(async () => {
    const messages = stream({
      exchange: 'polymarket',
      filters: [
        {
          channel: 'book'
        }
      ],
      timeoutIntervalMS: 0
    })

    await messages.next()
  }).rejects.toThrow('PolymarketRealTimeFeed requires explicitly specified symbols when subscribing to CLOB live feed')
})

test('polymarket realtime feed rejects unsupported channels', async () => {
  await expect(async () => {
    const messages = stream({
      exchange: 'polymarket',
      filters: [
        {
          channel: 'unsupported' as any,
          symbols: ['123']
        }
      ],
      timeoutIntervalMS: 0
    })

    await messages.next()
  }).rejects.toThrow('PolymarketRealTimeFeed unsupported channel unsupported')
})

test('classify polymarket clob realtime control messages', () => {
  const feed = new TestPolymarketClobRealTimeFeed('polymarket', [], undefined)

  expect(
    feed.isError({
      error: 'Invalid asset ids'
    })
  ).toBe(true)

  const pong = JSON.parse(feed.decompressMessage(Buffer.from('PONG')).toString())
  expect(feed.isHeartbeat(pong)).toBe(true)
})

test('map polymarket sports realtime subscription', () => {
  const feed = new TestPolymarketSportsRealTimeFeed('polymarket', [], undefined)

  expect(feed.map([{ channel: 'sport_result' }])).toEqual([])
})

test('classify polymarket sports realtime control messages', () => {
  const feed = new TestPolymarketSportsRealTimeFeed('polymarket', [], undefined)

  expect(
    feed.isError({
      error: 'Invalid subscription'
    })
  ).toBe(true)

  const ping = JSON.parse(feed.decompressMessage(Buffer.from('ping')).toString())
  expect(feed.isHeartbeat(ping)).toBe(true)
})
