import { Message } from './types'
import { ONE_SEC_IN_MS, wait } from './handy'

type NextMessageResultWitIndex = {
  index: number
  result: IteratorResult<Message, Message>
}

async function getNextResultWithIndex(iterator: AsyncIterableIterator<Message>, index: number): Promise<NextMessageResultWitIndex> {
  const result = await iterator.next()

  return {
    result,
    index
  }
}

function findOldestResult(oldest: NextMessageResultWitIndex, current: NextMessageResultWitIndex) {
  if (oldest.result.done) {
    return oldest
  }

  if (current.result.done) {
    return current
  }

  if (current.result.value.localTimestamp < oldest.result.value.localTimestamp) {
    return current
  }
  return oldest
}

// based on https://github.com/fraxken/combine-async-iterators
// combines multiple iterators with Messages from for example multiple exchanges
// works both for real-time and historical data

export async function* combine(...iterators: AsyncIterableIterator<Message>[]) {
  const nextMessages = iterators.map(getNextResultWithIndex)
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
      nextMessages[index] = getNextResultWithIndex(iterators[index], index)
    }
  } else {
    const results = await Promise.all(nextMessages)
    do {
      // if we're deailing with historical data replay
      // we need to return combined messages sorted by local timestamp in acending order
      const oldestResult = results.reduce(findOldestResult, results[0])
      const { result, index } = oldestResult

      // TODO: rethink indexes!!!!
      if (result.done) {
        // remove already done iterables from results
        results.splice(oldestResult.index, 1)
      } else {
        // yield oldest value and replace with next value from iterable for given index
        yield result.value
        const indexWithOffset = oldestResult.index - aliveIteratorsCount
        results[indexWithOffset] = await getNextResultWithIndex(iterators[index], index)
      }
    } while (results.length > 0)
  }
}
