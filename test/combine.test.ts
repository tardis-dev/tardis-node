import { tardis, combine } from '../dist'

describe('combine(...asyncIterators)', () => {
  test('should produce combined iterable from two replayNormalized iterables', async () => {
    const bitmexMessages = tardis.replayNormalized({
      exchange: 'bitmex',
      from: '2019-04-01',
      to: '2019-04-01 00:01',
      dataTypes: ['trade', 'book_change'],
      symbols: ['XBTUSD']
    })

    const deribitMessages = tardis.replayNormalized({
      exchange: 'deribit',
      dataTypes: ['trade', 'book_change'],
      from: '2019-04-01',
      to: '2019-04-01 00:01',
      symbols: ['BTC-PERPETUAL']
    })

    const bufferedMessages = []
    for await (const message of combine(bitmexMessages, deribitMessages)) {
      bufferedMessages.push(message)
    }

    expect(bufferedMessages).toMatchSnapshot()
  })

  test('should correctly combine iterables based on localTimestamp value', async () => {
    let iter1 = async function*() {
      yield { localTimestamp: new Date('2019-08-01T08:52:00.132Z') }
      yield { localTimestamp: new Date('2019-08-01T08:53:00.130Z') }
    }

    let iter2 = async function*() {
      yield { localTimestamp: new Date('2019-08-01T00:52:00.132Z') }
      yield { localTimestamp: new Date('2019-08-01T00:52:00.133Z') }
      yield { localTimestamp: new Date('2019-08-01T08:53:00.130Z') }
      yield { localTimestamp: new Date('2019-08-01T08:53:00.131Z') }
    }

    let combined = combine(iter1(), iter2())

    let bufferedMessages = []
    for await (const message of combined) {
      bufferedMessages.push(message)
    }

    expect(bufferedMessages).toMatchSnapshot()

    iter1 = async function*() {
      yield { localTimestamp: new Date('2019-08-01T00:52:00.102Z') }
      yield { localTimestamp: new Date('2019-08-01T00:53:00.130Z') }
    }

    iter2 = async function*() {
      yield { localTimestamp: new Date('2019-08-01T00:52:00.132Z') }
      yield { localTimestamp: new Date('2019-08-01T00:52:00.133Z') }
      yield { localTimestamp: new Date('2019-08-01T08:53:00.130Z') }
      yield { localTimestamp: new Date('2019-08-01T08:53:00.131Z') }
      yield { localTimestamp: new Date('2019-08-02T08:53:00.131Z') }
    }

    combined = combine(iter1(), iter2())

    bufferedMessages = []
    for await (const message of combined) {
      bufferedMessages.push(message)
    }

    expect(bufferedMessages).toMatchSnapshot()
  })
})
