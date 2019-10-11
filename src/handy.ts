import { createHash } from 'crypto'
import { Message } from './types'

export function parseAsUTCDate(val: string) {
  // not sure about this one, but it should force parsing date as UTC date not as local timezone
  if (val.endsWith('Z') === false) {
    val += 'Z'
  }
  var date = new Date(val)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()))
}

export function wait(delayMS: number) {
  return new Promise(resolve => {
    setTimeout(resolve, delayMS)
  })
}

export function formatDateToPath(date: Date) {
  const year = date.getUTCFullYear()
  const month = doubleDigit(date.getUTCMonth() + 1)
  const day = doubleDigit(date.getUTCDate())
  const hour = doubleDigit(date.getUTCHours())
  const minute = doubleDigit(date.getUTCMinutes())

  return `${year}/${month}/${day}/${hour}/${minute}`
}

function doubleDigit(input: number) {
  return input < 10 ? '0' + input : '' + input
}

export function sha256(obj: object) {
  return createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex')
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000)
}

export function* sequence(end: number, seed = 0) {
  let current = seed
  while (current < end) {
    yield current
    current += 1
  }

  return
}

export const ONE_SEC_IN_MS = 1000

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly responseText: string, public readonly url: string) {
    super(`HttpError: status code ${status}`)
  }
}

type NextMessageResult = {
  index: number
  result: IteratorResult<Message, Message>
}
async function getNextMessage(iterator: AsyncIterableIterator<Message>, index: number): Promise<NextMessageResult> {
  const result = await iterator.next()

  return {
    result,
    index
  }
}

function compare(a: NextMessageResult, b: NextMessageResult) {
  if (a.result.done) {
    return -1
  }
  if (b.result.done) {
    return 1
  }

  return a.result.value.localTimestamp < b.result.value.localTimestamp ? -1 : 1
}

// based on https://github.com/fraxken/combine-async-iterators

export async function* combine(...iterators: AsyncIterableIterator<Message>[]) {
  const nextMessages = iterators.map(getNextMessage)
  let { result } = await Promise.race(nextMessages)
  const firstReceivedMessage = result.value
  const now = new Date()
  const THREE_MINUTES_IN_MS = 3 * 60 * ONE_SEC_IN_MS
  // based on local timestamp of first message decide if iterators provide is real time data
  // if first message is less than three minutes 'old' in comparison to current time
  // consider such iterators as real-time and return message in FIFO order - using promise.race
  const isRealTime = firstReceivedMessage.localTimestamp.valueOf() + THREE_MINUTES_IN_MS > now.valueOf()

  if (isRealTime) {
    while (true) {
      // this does not handle iterators that are finite,
      // as we'd have to handle case when result.done is set to true
      // but in practice real-time streams are infinite
      const { index, result } = await Promise.race(nextMessages)
      yield result.value as Message
      nextMessages[index] = getNextMessage(iterators[index], index)
    }
  } else {
    const results = await Promise.all(nextMessages)
    let aliveIteratorsCount = iterators.length
    do {
      // if we're deailing with historical data replay
      // return combined messages sorted by local timestamp in acending order
      results.sort(compare)
      const { result: oldestResult, index } = results[0]

      if (oldestResult.done) {
        aliveIteratorsCount--
        // replace promise with next message at index that is done with promise that never resolved
        nextMessages.splice(index, 1)
        nextMessages[index] = new Promise(() => null)
      } else {
        yield oldestResult.value
        nextMessages[index] = getNextMessage(iterators[index], index)
      }
    } while (aliveIteratorsCount > 0)
  }
}
