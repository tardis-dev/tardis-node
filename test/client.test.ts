import { TardisClient, ReplayOptions } from '../dist'

const tardisClient = new TardisClient()

describe('client', () => {
  test('invalid args validation', async () => {
    await expect(tardisClient.replay({ exchange: 'binance', from: 'sdf', to: 'dsf' }).next()).rejects.toThrowError()

    await expect(
      tardisClient.replay({ exchange: 'binances' as any, from: '2019-05-05 00:00', to: '2019-05-05 00:05' }).next()
    ).rejects.toThrowError()

    await expect(
      tardisClient.replay({ exchange: 'binance', from: '2019-06-05 00:00', to: '2019-05-05 00:05' }).next()
    ).rejects.toThrowError()

    await expect(
      tardisClient.replay({ exchange: 'binance', from: '2019-06-05 00:00Z', to: '2019-05-05 00:05Z' }).next()
    ).rejects.toThrowError()

    await expect(
      tardisClient
        .replay({ exchange: 'binance', from: '2019-04-05 00:00Z', to: '2019-05-05 00:05Z', filters: [{ channel: 'trades' as any }] })
        .next()
    ).rejects.toThrowError()

    await expect(tardisClient.replayRaw({ exchange: 'binance', from: 'sdf', to: 'dsf' }).next()).rejects.toThrowError()

    await expect(
      tardisClient.replayRaw({ exchange: 'binances' as any, from: '2019-05-05 00:00', to: '2019-05-05 00:05' }).next()
    ).rejects.toThrowError()

    await expect(
      tardisClient.replayRaw({ exchange: 'binance', from: '2019-06-05 00:00', to: '2019-05-05 00:05' }).next()
    ).rejects.toThrowError()

    await expect(
      tardisClient.replayRaw({ exchange: 'binance', from: '2019-06-05 00:00Z', to: '2019-05-05 00:05Z' }).next()
    ).rejects.toThrowError()

    await expect(
      tardisClient
        .replayRaw({
          exchange: 'binance',
          from: '2019-04-05 00:00Z',
          to: '2019-05-05 00:05Z',
          filters: [{ channel: 'trades' as any }]
        })
        .next()
    ).rejects.toThrowError()
  })

  test(
    'replays Bitmex data feed (ETHUSD trades) for 1st of April 2019 and compares with raw sample',
    async () => {
      const replayOptions: ReplayOptions<'bitmex'> = {
        exchange: 'bitmex',
        from: '2019-05-01 00:00',
        to: '2019-05-01 10:05',
        filters: [
          {
            channel: 'trade',
            symbols: ['ETHUSD']
          }
        ]
      }

      const bitmexDataFeedMessages = tardisClient.replay(replayOptions)
      const receivedMessages = []
      const receivedTimestamps = []

      for await (let { message, localTimestamp } of bitmexDataFeedMessages) {
        receivedMessages.push(message)
        receivedTimestamps.push(localTimestamp)
      }

      expect(receivedMessages).toMatchSnapshot('bitmex-received-messages')
      expect(receivedTimestamps).toMatchSnapshot('bitmex-received-timestamps')

      // perfrom the same test but get raw feed and decode here manually
      const bitmexDataFeedRawMessages = tardisClient.replayRaw(replayOptions)
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
    'replays Coinbase data feed for 1st of Jun 2019 (ZEC-USDC trades)',
    async () => {
      const coinbaseDataFeedMessages = tardisClient.replay({
        exchange: 'coinbase',
        from: '2019-06-01',
        to: '2019-06-02',
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
    'replays Binance data feed for 1st of Jun 2019 (batpax trades)',
    async () => {
      const binanceDataFeedMessages = tardisClient.replay({
        exchange: 'binance',
        from: '2019-06-01',
        to: '2019-06-02 00:00',
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
    const dataFeedWithUnautorizedAccesss = tardisClient.replay({
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

  test.skip(
    'clears cache dir',
    async () => {
      await tardisClient.clearCache()
    },
    1000 * 60
  )
})
