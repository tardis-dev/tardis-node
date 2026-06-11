import { Filter } from '../src/types.ts'
import { MexcRealTimeFeed } from '../src/realtimefeeds/mexc.ts'
import { getRealTimeFeedFactory } from '../src/realtimefeeds/index.ts'

class TestMexcRealTimeFeed extends MexcRealTimeFeed {
  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }

  parse(message: Buffer) {
    return this.parseMessage(message)
  }

  isError(message: any) {
    return this.messageIsError(message)
  }

  isHeartbeat(message: any) {
    return this.messageIsHeartbeat(message)
  }
}

test('register mexc realtime feed', () => {
  expect(getRealTimeFeedFactory('mexc')).toBeDefined()
})

test('map mexc realtime subscriptions', () => {
  const feed = new TestMexcRealTimeFeed('mexc', [], undefined)

  expect(
    feed.map([
      {
        channel: 'spot@public.aggre.deals.v3.api.pb@10ms',
        symbols: ['btcusdt', 'ETHUSDT']
      },
      {
        channel: 'spot@public.aggre.depth.v3.api.pb@10ms',
        symbols: ['BTCUSDT']
      },
      {
        channel: 'spot@public.aggre.bookTicker.v3.api.pb@100ms',
        symbols: ['BTCUSDT']
      }
    ])
  ).toEqual([
    {
      method: 'SUBSCRIPTION',
      params: [
        'spot@public.aggre.deals.v3.api.pb@10ms@BTCUSDT',
        'spot@public.aggre.deals.v3.api.pb@10ms@ETHUSDT',
        'spot@public.aggre.depth.v3.api.pb@10ms@BTCUSDT',
        'spot@public.aggre.bookTicker.v3.api.pb@100ms@BTCUSDT'
      ]
    }
  ])
})

test('mexc realtime subscriptions require symbols', () => {
  const feed = new TestMexcRealTimeFeed('mexc', [], undefined)

  expect(() =>
    feed.map([
      {
        channel: 'spot@public.aggre.deals.v3.api.pb@10ms'
      }
    ])
  ).toThrow('MexcRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
})

test('mexc realtime rejects unsupported channels', () => {
  const feed = new TestMexcRealTimeFeed('mexc', [], undefined)

  expect(() =>
    feed.map([
      {
        channel: 'unsupported',
        symbols: ['BTCUSDT']
      }
    ])
  ).toThrow('MexcRealTimeFeed unsupported channel unsupported')
})

test('classify mexc realtime control messages', () => {
  const feed = new TestMexcRealTimeFeed('mexc', [], undefined)

  expect(feed.isHeartbeat({ msg: 'PONG' })).toBe(true)
  expect(feed.isError({ code: 0, msg: 'spot@public.aggre.deals.v3.api.pb@10ms@BTCUSDT' })).toBe(false)
  expect(feed.isError({ code: 1, msg: 'invalid request' })).toBe(true)
})

test('decode mexc realtime protobuf trade message', () => {
  const feed = new TestMexcRealTimeFeed('mexc', [], undefined)
  const trade = message(stringField(1, '100.1'), stringField(2, '0.2'), varintField(3, 1), varintField(4, 1710000000001))
  const publicAggreDeals = message(bytesField(1, trade), stringField(2, 'spot@public.aggre.deals.v3.api.pb@10ms'))
  const wrapper = message(
    stringField(1, 'spot@public.aggre.deals.v3.api.pb@10ms@BTCUSDT'),
    stringField(3, 'BTCUSDT'),
    varintField(6, 1710000000000),
    bytesField(314, publicAggreDeals)
  )

  expect(feed.parse(wrapper)).toEqual({
    channel: 'spot@public.aggre.deals.v3.api.pb@10ms@BTCUSDT',
    symbol: 'BTCUSDT',
    sendTime: '1710000000000',
    publicAggreDeals: {
      deals: [
        {
          price: '100.1',
          quantity: '0.2',
          tradeType: 1,
          time: '1710000000001'
        }
      ],
      eventType: 'spot@public.aggre.deals.v3.api.pb@10ms'
    }
  })
})

test('decode mexc realtime protobuf depth message', () => {
  const feed = new TestMexcRealTimeFeed('mexc', [], undefined)
  const ask = message(stringField(1, '100.1'), stringField(2, '1.2'))
  const bid = message(stringField(1, '99.9'), stringField(2, '0.5'))
  const publicAggreDepths = message(
    bytesField(1, ask),
    bytesField(2, bid),
    stringField(3, 'spot@public.aggre.depth.v3.api.pb@10ms'),
    stringField(4, '101'),
    stringField(5, '102')
  )
  const wrapper = message(
    stringField(1, 'spot@public.aggre.depth.v3.api.pb@10ms@BTCUSDT'),
    stringField(3, 'BTCUSDT'),
    varintField(6, 1710000000000),
    bytesField(313, publicAggreDepths)
  )

  expect(feed.parse(wrapper)).toEqual({
    channel: 'spot@public.aggre.depth.v3.api.pb@10ms@BTCUSDT',
    symbol: 'BTCUSDT',
    sendTime: '1710000000000',
    publicAggreDepths: {
      asks: [{ price: '100.1', quantity: '1.2' }],
      bids: [{ price: '99.9', quantity: '0.5' }],
      eventType: 'spot@public.aggre.depth.v3.api.pb@10ms',
      fromVersion: '101',
      toVersion: '102'
    }
  })
})

test('decode mexc realtime protobuf book ticker message', () => {
  const feed = new TestMexcRealTimeFeed('mexc', [], undefined)
  const publicAggreBookTicker = message(stringField(1, '99.9'), stringField(2, '1.2'), stringField(3, '100.1'), stringField(4, '2.3'))
  const wrapper = message(
    stringField(1, 'spot@public.aggre.bookTicker.v3.api.pb@100ms@BTCUSDT'),
    stringField(3, 'BTCUSDT'),
    varintField(6, 1710000000000),
    bytesField(315, publicAggreBookTicker)
  )

  expect(feed.parse(wrapper)).toEqual({
    channel: 'spot@public.aggre.bookTicker.v3.api.pb@100ms@BTCUSDT',
    symbol: 'BTCUSDT',
    sendTime: '1710000000000',
    publicAggreBookTicker: {
      bidPrice: '99.9',
      bidQuantity: '1.2',
      askPrice: '100.1',
      askQuantity: '2.3'
    }
  })
})

function message(...fields: Buffer[]) {
  return Buffer.concat(fields)
}

function stringField(fieldNumber: number, value: string) {
  return bytesField(fieldNumber, Buffer.from(value))
}

function bytesField(fieldNumber: number, value: Buffer) {
  return Buffer.concat([tag(fieldNumber, 2), varint(value.length), value])
}

function varintField(fieldNumber: number, value: number) {
  return Buffer.concat([tag(fieldNumber, 0), varint(value)])
}

function tag(fieldNumber: number, wireType: number) {
  return varint(fieldNumber * 8 + wireType)
}

function varint(value: number) {
  const bytes: number[] = []
  let remaining = BigInt(value)
  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n))
    remaining >>= 7n
  }
  bytes.push(Number(remaining))
  return Buffer.from(bytes)
}
