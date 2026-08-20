import { describe, test } from 'node:test'
import { combine } from '../dist/index.js'
import { assert, snapshot } from './assertions.ts'

describe('combine(...asyncIterators)', () => {
  test('should correctly combine iterables based on localTimestamp value', async () => {
    let iter1 = async function* () {
      yield { localTimestamp: new Date('2019-08-01T08:52:00.132Z') }
      yield { localTimestamp: new Date('2019-08-01T08:53:00.130Z') }
    }

    let iter2 = async function* () {
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

    snapshot(bufferedMessages)

    iter1 = async function* () {
      yield { localTimestamp: new Date('2019-08-01T00:52:00.102Z') }
      yield { localTimestamp: new Date('2019-08-01T00:53:00.130Z') }
    }

    iter2 = async function* () {
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

    snapshot(bufferedMessages)

    iter1 = async function* () {
      var localTimestamp = new Date('2019-08-01T00:52:00.102Z')
      localTimestamp.μs = 202
      yield { localTimestamp, name: 'iter1' }
    }

    iter2 = async function* () {
      var localTimestamp = new Date('2019-08-01T00:52:00.102Z')
      localTimestamp.μs = 102
      yield { localTimestamp, name: 'iter2' }
    }

    combined = combine(iter1(), iter2())

    bufferedMessages = []
    for await (const message of combined) {
      bufferedMessages.push(message)
    }

    snapshot(bufferedMessages)
  })

  test('applies descriptor offsets and completes without cleanup errors', async () => {
    async function* messages(name: string, localTimestamp: string) {
      yield { name, localTimestamp: new Date(localTimestamp) }
    }

    const combined = combine(
      { stream: messages('number', '2026-01-01T00:00:01.000Z'), offsetMS: -1000 },
      { stream: messages('function', '2026-01-01T00:00:00.500Z'), offsetMS: () => 1000 }
    )
    const actual = []

    for await (const message of combined) {
      actual.push({ name: message.name, localTimestamp: message.localTimestamp.toISOString() })
    }

    assert.deepEqual(actual, [
      { name: 'number', localTimestamp: '2026-01-01T00:00:00.000Z' },
      { name: 'function', localTimestamp: '2026-01-01T00:00:01.500Z' }
    ])
  })

  test('closes descriptor streams when the consumer stops early', async () => {
    let closedStreams = 0
    async function* messages(name: string, localTimestamp: string) {
      try {
        yield { name, localTimestamp: new Date(localTimestamp) }
        yield { name, localTimestamp: new Date('2026-01-01T00:01:00.000Z') }
      } finally {
        closedStreams++
      }
    }

    const combined = combine(
      { stream: messages('first', '2026-01-01T00:00:00.000Z'), offsetMS: 0 },
      { stream: messages('second', '2026-01-01T00:00:01.000Z'), offsetMS: 0 }
    )

    for await (const _ of combined) {
      break
    }

    assert.equal(closedStreams, 2)
  })
})
