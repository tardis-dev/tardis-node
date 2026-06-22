import { Filter } from '../src/types.ts'
import { getRealTimeFeedFactory } from '../src/realtimefeeds/index.ts'
import { PaxosChannelRealTimeFeed, PaxosRealTimeFeed } from '../src/realtimefeeds/paxos.ts'

class TestPaxosRealTimeFeed extends PaxosRealTimeFeed {
  constructor(private readonly _paxosFilters: Filter<string>[]) {
    super('paxos', _paxosFilters, undefined)
  }

  getUrls() {
    return Promise.all(
      [...this._getRealTimeFeeds('paxos', this._paxosFilters, undefined)].map((feed: any) => feed.getWebSocketUrl() as Promise<string>)
    )
  }
}

class TestPaxosChannelRealTimeFeed extends PaxosChannelRealTimeFeed {
  constructor(filters: Filter<string>[]) {
    super('paxos', filters, undefined, undefined)
  }

  getUrl() {
    return this.getWebSocketUrl()
  }

  map(filters: Filter<string>[]) {
    return this.mapToSubscribeMessages(filters)
  }

  isError(message: any) {
    return this.messageIsError(message)
  }
}

test('register paxos realtime feed', () => {
  expect(getRealTimeFeedFactory('paxos')).toBeDefined()
})

test('map paxos realtime executiondata urls', async () => {
  await expect(new TestPaxosChannelRealTimeFeed([{ channel: 'executiondata' }]).getUrl()).resolves.toBe('wss://ws.paxos.com/executiondata')

  await expect(new TestPaxosChannelRealTimeFeed([{ channel: 'executiondata', symbols: ['BTCUSD'] }]).getUrl()).resolves.toBe(
    'wss://ws.paxos.com/executiondata/BTCUSD'
  )

  await expect(new TestPaxosChannelRealTimeFeed([{ channel: 'executiondata', symbols: ['BTCUSD', 'ETHUSD'] }]).getUrl()).resolves.toBe(
    'wss://ws.paxos.com/executiondata'
  )
})

test('map paxos realtime marketdata urls', async () => {
  await expect(new TestPaxosChannelRealTimeFeed([{ channel: 'marketdata' }]).getUrl()).resolves.toBe('wss://ws.paxos.com/marketdata')

  await expect(new TestPaxosChannelRealTimeFeed([{ channel: 'marketdata', symbols: ['BTCUSD'] }]).getUrl()).resolves.toBe(
    'wss://ws.paxos.com/marketdata/BTCUSD'
  )

  await expect(new TestPaxosChannelRealTimeFeed([{ channel: 'marketdata', symbols: ['BTCUSD', 'ETHUSD'] }]).getUrl()).resolves.toBe(
    'wss://ws.paxos.com/marketdata'
  )
})

test('map paxos realtime stablecoin urls', async () => {
  await expect(new TestPaxosChannelRealTimeFeed([{ channel: 'marketdata/stablecoin' }]).getUrl()).resolves.toBe(
    'wss://ws.paxos.com/marketdata/stablecoin'
  )

  await expect(new TestPaxosChannelRealTimeFeed([{ channel: 'marketdata/stablecoin', symbols: ['USDCUSD'] }]).getUrl()).resolves.toBe(
    'wss://ws.paxos.com/marketdata/stablecoin/USDCUSD'
  )

  await expect(
    new TestPaxosChannelRealTimeFeed([{ channel: 'marketdata/stablecoin', symbols: ['USDCUSD', 'PYUSDUSD'] }]).getUrl()
  ).resolves.toBe('wss://ws.paxos.com/marketdata/stablecoin')
})

test('map paxos realtime multi-channel urls', async () => {
  const feed = new TestPaxosRealTimeFeed([
    { channel: 'executiondata', symbols: ['BTCUSD', 'ETHUSD'] },
    { channel: 'marketdata', symbols: ['BTCUSD', 'ETHUSD'] },
    { channel: 'marketdata/stablecoin', symbols: ['USDCUSD', 'PYUSDUSD'] }
  ])

  await expect(feed.getUrls()).resolves.toEqual([
    'wss://ws.paxos.com/executiondata',
    'wss://ws.paxos.com/marketdata',
    'wss://ws.paxos.com/marketdata/stablecoin'
  ])
})

test('map paxos realtime subscribe messages', () => {
  const feed = new TestPaxosChannelRealTimeFeed([{ channel: 'marketdata' }])

  expect(feed.map([{ channel: 'marketdata', symbols: ['BTCUSD'] }])).toEqual([])
})

test('classify paxos realtime error messages', () => {
  const feed = new TestPaxosChannelRealTimeFeed([{ channel: 'marketdata' }])

  expect(feed.isError({ error: 'Not Found' })).toBe(true)
  expect(feed.isError({ type: 'SNAPSHOT', market: 'BTCUSD' })).toBe(false)
})
