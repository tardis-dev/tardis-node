import { tardis, ReplayOptions, EXCHANGES, createMapper, DataType } from '../dist'

describe('tardis', () => {
  test('invalid args validation', async () => {
    await expect(tardis.replay({ exchange: 'binance', from: 'sdf', to: 'dsf', filters: [] }).next()).rejects.toThrowError()

    await expect(
      tardis.replay({ exchange: 'binances' as any, from: '2019-05-05 00:00', to: '2019-05-05 00:05', filters: [] }).next()
    ).rejects.toThrowError()

    await expect(
      tardis.replay({ exchange: 'binance', from: '2019-06-05 00:00', to: '2019-05-05 00:05', filters: [] }).next()
    ).rejects.toThrowError()

    await expect(
      tardis.replay({ exchange: 'binance', from: '2019-06-05 00:00Z', to: '2019-05-05 00:05Z', filters: [] }).next()
    ).rejects.toThrowError()

    await expect(
      tardis
        .replay({ exchange: 'binance', from: '2019-04-05 00:00Z', to: '2019-05-05 00:05Z', filters: [{ channel: 'trades' as any }] })
        .next()
    ).rejects.toThrowError()

    await expect(
      tardis.replay({ exchange: 'binance', from: 'sdf', to: 'dsf', filters: [], skipDecoding: true }).next()
    ).rejects.toThrowError()

    await expect(
      tardis
        .replay({ exchange: 'binances' as any, from: '2019-05-05 00:00', to: '2019-05-05 00:05', skipDecoding: true, filters: [] })
        .next()
    ).rejects.toThrowError()

    await expect(
      tardis.replay({ exchange: 'binance', from: '2019-06-05 00:00', to: '2019-05-05 00:05', skipDecoding: true, filters: [] }).next()
    ).rejects.toThrowError()

    await expect(
      tardis.replay({ exchange: 'binance', from: '2019-06-05 00:00Z', to: '2019-05-05 00:05Z', skipDecoding: true, filters: [] }).next()
    ).rejects.toThrowError()

    await expect(
      tardis
        .replay({
          exchange: 'binance',
          from: '2019-04-05 00:00Z',
          to: '2019-05-05 00:05Z',
          filters: [{ channel: 'trades' as any }],
          skipDecoding: true
        })
        .next()
    ).rejects.toThrowError()
  })

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

      const bitmexDataFeedMessages = tardis.replay(replayOptions)
      const receivedMessages = []
      const receivedTimestamps = []

      for await (let { message, localTimestamp } of bitmexDataFeedMessages) {
        receivedMessages.push(message)
        receivedTimestamps.push(localTimestamp)
      }

      expect(receivedMessages).toMatchSnapshot('bitmex-received-messages')
      expect(receivedTimestamps).toMatchSnapshot('bitmex-received-timestamps')

      // perfrom the same test but get raw feed and decode here manually
      const bitmexDataFeedRawMessages = tardis.replay({ ...replayOptions, skipDecoding: true })
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
      const coinbaseDataFeedMessages = tardis.replay({
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
      const binanceDataFeedMessages = tardis.replay({
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
    const dataFeedWithUnautorizedAccesss = tardis.replay({
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
      for (const exchange of EXCHANGES) {
        const exchangeDetails = await tardis.getExchangeDetails(exchange)

        exchangeDetails.availableSymbols.sort((a, b) => (a.id < b.id ? 1 : -1))
        const validPrefixes = ['btc', 'xbt', 'pi_']
        const availableSymbols = exchangeDetails.availableSymbols.filter(s =>
          validPrefixes.some(p => s.id.toLocaleLowerCase().startsWith(p))
        )

        const from = new Date(availableSymbols[0].availableSince)
        from.setUTCMonth(from.getUTCMonth() + 1)
        from.setUTCDate(1)
        const to = new Date(from)
        to.setUTCDate(2)
        const dataTypes: DataType[] = createMapper(exchange).supportedDataTypes as any

        const messages = tardis.replayNormalized({
          exchange,
          from: from.toISOString(),
          to: to.toISOString(),
          dataTypes,
          symbols: availableSymbols.slice(0, 2).map(s => s.id),
          withDisconnectMessages: true
        })

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

  test(
    'streams real-time messages for each supported exchange',
    async () => {
      const skippedExchanges = ['bitstamp', 'binance-dex']
      for (const exchange of EXCHANGES) {
        if (skippedExchanges.includes(exchange)) {
          continue
        }

        const exchangeDetails = await tardis.getExchangeDetails(exchange)
        const dataTypes: DataType[] = createMapper(exchange).supportedDataTypes as any
        const validPrefixes = ['btc', 'xbt', 'pi_']
        const availableSymbols = exchangeDetails.availableSymbols.filter(s =>
          validPrefixes.some(p => s.id.toLocaleLowerCase().startsWith(p))
        )
        const messages = tardis.streamNormalized({
          exchange,
          dataTypes,
          symbols: availableSymbols
            .filter(s => s.availableTo === undefined)
            .slice(0, 2)
            .map(s => s.id)
        })

        let count = 0
        for await (const _ of messages) {
          if (count >= 50) {
            break
          }
          count++
        }
      }
    },
    1000 * 60 * 10
  )

  test.skip(
    'clears cache dir',
    async () => {
      await tardis.clearCache()
    },
    1000 * 60
  )
})
