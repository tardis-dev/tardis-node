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
})
