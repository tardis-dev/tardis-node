import {
  clearCache,
  Exchange,
  EXCHANGES,
  normalizeBookChanges,
  normalizeDerivativeTickers,
  normalizeTrades,
  replay,
  replayNormalized,
  ReplayOptions
} from '../dist'

const exchangesWithDerivativeInfo: Exchange[] = [
  'bitmex',
  'binance-futures',
  'bitfinex-derivatives',
  'cryptofacilities',
  'deribit',
  'okex',
  'bybit'
]

describe('replay', () => {
  beforeEach(() => {
    return clearCache()
  }, 1000 * 60 * 10)

  test(
    'invalid args validation',
    async () => {
      await expect(replay({ exchange: 'binance', from: 'sdf', to: 'dsf', filters: [] }).next()).rejects.toThrowError()

      await expect(
        replay({ exchange: 'binances' as any, from: '2019-05-05 00:00', to: '2019-05-05 00:05', filters: [] }).next()
      ).rejects.toThrowError()

      await expect(
        replay({ exchange: 'binance', from: '2019-06-05 00:00', to: '2019-05-05 00:05', filters: [] }).next()
      ).rejects.toThrowError()

      await expect(
        replay({ exchange: 'binance', from: '2019-06-05 00:00Z', to: '2019-05-05 00:05Z', filters: [] }).next()
      ).rejects.toThrowError()

      await expect(
        replay({ exchange: 'binance', from: '2019-04-05 00:00Z', to: '2019-05-05 00:05Z', filters: [{ channel: 'trades' as any }] }).next()
      ).rejects.toThrowError()

      await expect(replay({ exchange: 'binance', from: 'sdf', to: 'dsf', filters: [], skipDecoding: true }).next()).rejects.toThrowError()

      await expect(
        replay({ exchange: 'binances' as any, from: '2019-05-05 00:00', to: '2019-05-05 00:05', skipDecoding: true, filters: [] }).next()
      ).rejects.toThrowError()

      await expect(
        replay({ exchange: 'binance', from: '2019-06-05 00:00', to: '2019-05-05 00:05', skipDecoding: true, filters: [] }).next()
      ).rejects.toThrowError()

      await expect(
        replay({ exchange: 'binance', from: '2019-06-05 00:00Z', to: '2019-05-05 00:05Z', skipDecoding: true, filters: [] }).next()
      ).rejects.toThrowError()

      await expect(
        replay({
          exchange: 'binance',
          from: '2019-04-05 00:00Z',
          to: '2019-05-05 00:05Z',
          filters: [{ channel: 'trades' as any }],
          skipDecoding: true
        }).next()
      ).rejects.toThrowError()
    },
    1000 * 60 * 10
  )

  test(
    'replays raw Bitmex data feed (ETHUSD trades) for 1st of April 2019 and compares with not decoded sample',
    async () => {
      const replayOptions: ReplayOptions<'bitmex'> = {
        exchange: 'bitmex',
        from: '2019-05-01 00:00',
        to: '2019-05-01 01:05',
        filters: [
          {
            channel: 'trade',
            symbols: ['ETHUSD']
          }
        ]
      }

      const bitmexDataFeedMessages = replay(replayOptions)
      const receivedMessages = []
      const receivedTimestamps = []

      for await (let { message, localTimestamp } of bitmexDataFeedMessages) {
        receivedMessages.push(message)
        receivedTimestamps.push(localTimestamp)
      }

      expect(receivedMessages).toMatchSnapshot('bitmex-received-messages')
      expect(receivedTimestamps).toMatchSnapshot('bitmex-received-timestamps')

      // perfrom the same test but get raw feed and decode here manually
      const bitmexDataFeedRawMessages = replay({ ...replayOptions, skipDecoding: true })
      const receivedMessagesOfRawFeed = []
      const receivedTimestampsOfRawFeed = []

      for await (let { message, localTimestamp } of bitmexDataFeedRawMessages) {
        receivedMessagesOfRawFeed.push(JSON.parse(message.toString()))
        receivedTimestampsOfRawFeed.push(new Date(localTimestamp.toString()))
      }

      expect(receivedMessagesOfRawFeed).toMatchSnapshot('bitmex-received-messages')
      expect(receivedTimestampsOfRawFeed).toMatchSnapshot('bitmex-received-timestamps')
    },
    1000 * 60 * 10
  )

  test(
    'replays raw Coinbase data feed for 1st of Jun 2019 (ZEC-USDC trades)',
    async () => {
      const coinbaseDataFeedMessages = replay({
        exchange: 'coinbase',
        from: '2019-06-01',
        to: '2019-06-01 02:00',
        filters: [
          {
            channel: 'match',
            symbols: ['ZEC-USDC']
          }
        ]
      })

      const receivedMessages = []
      const receivedTimestamps = []

      for await (let { message, localTimestamp } of coinbaseDataFeedMessages) {
        receivedMessages.push(JSON.stringify(message))
        receivedTimestamps.push(localTimestamp)
      }

      expect(receivedMessages).toMatchSnapshot()
      expect(receivedTimestamps).toMatchSnapshot()
    },
    1000 * 60 * 10
  )

  test(
    'replays raw Binance data feed for 1st of Jun 2019 (batpax trades)',
    async () => {
      const binanceDataFeedMessages = replay({
        exchange: 'binance',
        from: '2019-06-01',
        to: '2019-06-01 02:00',
        filters: [
          {
            channel: 'trade',
            symbols: ['batpax']
          }
        ]
      })

      const receivedMessages = []
      const receivedTimestamps = []

      for await (let { message, localTimestamp } of binanceDataFeedMessages) {
        receivedMessages.push(JSON.stringify(message))
        receivedTimestamps.push(localTimestamp)
      }

      expect(receivedMessages).toMatchSnapshot()
      expect(receivedTimestamps).toMatchSnapshot()
    },
    1000 * 60 * 10
  )

  test('unauthorizedAccess', async () => {
    const dataFeedWithUnautorizedAccesss = replay({
      exchange: 'binance',
      from: '2019-05-01 23:00',
      to: '2019-05-02 00:06',
      filters: [
        {
          channel: 'trade'
        }
      ]
    })
    let receivedCount = 0
    try {
      for await (let _ of dataFeedWithUnautorizedAccesss) {
        receivedCount++
      }
    } catch (e) {
      expect(e).toHaveProperty('status')
    }

    expect(receivedCount).toBe(0)
  })

  test(
    'replays normalized data for each supported exchange',
    async () => {
      const replayOptions = {
        bitmex: { symbols: ['XBTZ19', 'XBTUSD'], from: '2019-07-01T00:00:00.000Z', to: '2019-07-02T00:00:00.000Z' },
        deribit: { symbols: ['BTC-PERPETUAL', 'BTC-9AUG19-9500-P'], from: '2019-04-01T00:00:00.000Z', to: '2019-04-02T00:00:00.000Z' },
        binance: { symbols: ['btcusdt', 'btcusds'], from: '2019-04-01T00:00:00.000Z', to: '2019-04-02T00:00:00.000Z' },
        'binance-futures': { symbols: ['btcusdt'], from: '2019-10-01T00:00:00.000Z', to: '2019-10-02T00:00:00.000Z' },
        ftx: { symbols: ['BTC/USD', 'BTC-PERP'], from: '2019-09-01T00:00:00.000Z', to: '2019-09-02T00:00:00.000Z' },
        okex: { symbols: ['BTC-USDT'], from: '2019-04-01T00:00:00.000Z', to: '2019-04-02T00:00:00.000Z' },
        bitflyer: { symbols: ['BTC_JPY', 'BTCJPY30AUG2019'], from: '2019-09-01T00:00:00.000Z', to: '2019-09-02T00:00:00.000Z' },
        bitstamp: { symbols: ['btcusd', 'btceur'], from: '2019-04-01T00:00:00.000Z', to: '2019-04-02T00:00:00.000Z' },
        coinbase: { symbols: ['BTC-USDC', 'BTC-USD'], from: '2019-04-01T00:00:00.000Z', to: '2019-04-02T00:00:00.000Z' },
        cryptofacilities: { symbols: ['PI_XRPUSD', 'PI_XBTUSD'], from: '2019-04-01T00:00:00.000Z', to: '2019-04-02T00:00:00.000Z' },
        gemini: { symbols: ['btcusd'], from: '2019-09-01T00:00:00.000Z', to: '2019-09-02T00:00:00.000Z' },
        kraken: { symbols: ['XBT/USD', 'XBT/JPY'], from: '2019-07-01T00:00:00.000Z', to: '2019-07-02T00:00:00.000Z' },
        bitfinex: { symbols: ['BTCUST', 'BTCUSD'], from: '2019-10-01T00:00:00.000Z', to: '2019-10-02T00:00:00.000Z' },
        'bitfinex-derivatives': { symbols: ['BTCF0:USTF0'], from: '2019-10-01T00:00:00.000Z', to: '2019-10-02T00:00:00.000Z' },
        'binance-dex': {
          symbols: ['BTCB-1DE_USDSB-1AC', 'BTCB-1DE_TUSDB-888'],
          from: '2019-07-01T00:00:00.000Z',
          to: '2019-07-02T00:00:00.000Z'
        },
        'binance-jersey': { symbols: ['btcgbp', 'btceur'], from: '2019-11-01T00:00:00.000Z', to: '2019-11-02T00:00:00.000Z' },
        'binance-us': { symbols: ['btcusdt', 'btcusd'], from: '2019-10-01T00:00:00.000Z', to: '2019-10-02T00:00:00.000Z' }
      } as any

      for (const exchange of EXCHANGES) {
        if (replayOptions[exchange] === undefined) {
          continue
        }

        const normalizers = exchangesWithDerivativeInfo.includes(exchange)
          ? [normalizeTrades, normalizeBookChanges, normalizeDerivativeTickers]
          : [normalizeTrades, normalizeBookChanges]

        const messages = replayNormalized(
          {
            exchange,
            withDisconnectMessages: true,
            ...replayOptions[exchange]
          },
          ...(normalizers as any)
        )

        let count = 0
        const bufferedMessages = []

        for await (const message of messages) {
          bufferedMessages.push(message)
          count++
          if (count === 100) {
            break
          }
        }

        expect(bufferedMessages).toMatchSnapshot(exchange)
      }
    },
    1000 * 60 * 10
  )
})
