import { ONE_SEC_IN_MS } from './handy'

type NextMessageResultWitIndex = {
  index: number
  result: IteratorResult<LocallyTimestamped, LocallyTimestamped>
}

type LocallyTimestamped = { localTimestamp: Date }

const DATE_MAX = new Date(8640000000000000)

async function nextWithIndex(iterator: AsyncIterableIterator<LocallyTimestamped>, index: number): Promise<NextMessageResultWitIndex> {
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

// combines multiple iterators with Messages from for example multiple exchanges
// works both for real-time and historical data
export async function* combine<T extends LocallyTimestamped>(...iterators: AsyncIterableIterator<T>[]): AsyncIterableIterator<T> {
  if (iterators.length === 0) {
    return
  }
  const nextResults = iterators.map(nextWithIndex)
  let { result } = await Promise.race(nextResults)
  const firstReceivedMessage = result.value
  const now = new Date()
  const THREE_MINUTES_IN_MS = 3 * 60 * ONE_SEC_IN_MS
  // based on local timestamp of first message decide if iterators provide is real time data
  // if first message is less than three minutes 'old' in comparison to current time
  const isRealTime = firstReceivedMessage.localTimestamp.valueOf() + THREE_MINUTES_IN_MS > now.valueOf()

  if (isRealTime) {
    // return messages in FIFO order thanks to using Promise.race
    // based on https://github.com/fraxken/combine-async-iterators

    while (true) {
      // this does not handle iterators that are finite,
      // as we'd have to handle case when result.done is set to true
      // but in practice real-time streams are infinite
      const { index, result } = await Promise.race(nextResults)
      yield result.value as T
      nextResults[index] = nextWithIndex(iterators[index], index)
    }
  } else {
    const results = await Promise.all(nextResults)
    let aliveIteratorsCount = results.length
    do {
      // if we're deailing with historical data replay
      // and need to return combined messages iterable sorted by local timestamp in acending order

      const oldestResult = results.reduce(findOldestResult, results[0])
      const { result, index } = oldestResult

      if (result.done) {
        aliveIteratorsCount--
        // we don't want finished iterators to every be considered 'oldest' again
        // hence provide them with result that has local timestamp set to DATE_MAX

        results[index].result = {
          value: {
            localTimestamp: DATE_MAX
          }
        }
      } else {
        // yield oldest value and replace with next value from iterable for given index
        yield result.value as T
        results[index] = await nextWithIndex(iterators[index], index)
      }
    } while (aliveIteratorsCount > 0)
  }
}
