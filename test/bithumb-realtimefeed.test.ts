import { test } from 'node:test'
import { assert } from './assertions.ts'
import { BithumbRealTimeFeed } from '../dist/realtimefeeds/bithumb.js'
import { getRealTimeFeedFactory } from '../dist/realtimefeeds/index.js'
import type { Filter } from '../dist/types.js'

class TestBithumbRealTimeFeed extends BithumbRealTimeFeed {
  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }

  parse(message: Buffer) {
    return this.parseMessage(message)
  }

  isError(message: any) {
    return this.messageIsError(message)
  }
}

test('registers and maps Bithumb realtime subscriptions', () => {
  assert.ok(getRealTimeFeedFactory('bithumb'))

  const feed = new TestBithumbRealTimeFeed('bithumb', [], undefined)
  const [request] = feed.map([
    { channel: 'trade', symbols: ['KRW-BTC'] },
    { channel: 'orderbook', symbols: ['KRW-BTC', 'KRW-ETH'] }
  ])

  assert.equal(request.length, 4)
  assert.match(request[0].ticket, /^[0-9a-f-]{36}$/)
  assert.deepEqual(request.slice(1), [
    { type: 'trade', codes: ['KRW-BTC'] },
    { type: 'orderbook', codes: ['KRW-BTC', 'KRW-ETH'], level: 1 },
    { format: 'DEFAULT' }
  ])
})

test('requires symbols for Bithumb realtime subscriptions', () => {
  const feed = new TestBithumbRealTimeFeed('bithumb', [], undefined)

  assert.throws(() => feed.map([{ channel: 'trade' }]), /requires explicitly specified symbols/)
  assert.throws(() => feed.map([{ channel: 'unsupported', symbols: ['KRW-BTC'] }]), /unsupported channel unsupported/)
})

test('preserves Bithumb trade ids beyond the JavaScript safe integer range', () => {
  const feed = new TestBithumbRealTimeFeed('bithumb', [], undefined)
  const message = feed.parse(
    Buffer.from('{"type":"trade","code":"KRW-BTC","sequential_id":1077860633149466017,"timestamp":1790071150369,"stream_type":"REALTIME"}')
  )

  assert.equal(message.sequential_id, '1077860633149466017')
  assert.equal(feed.isError({ error: { name: 'NO_CODES', message: 'codes field is missing' } }), true)
  assert.equal(feed.isError(message), false)
})
