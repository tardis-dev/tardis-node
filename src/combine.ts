import { closeIterator, isManagedRealTimeIterator, mergeRealTime } from './realtimeiterator.ts'

type NextMessageResultWithIndex = {
  index: number
  result: IteratorResult<Combinable, Combinable>
}

type Combinable = { localTimestamp: Date }

const DATE_MAX = new Date(8640000000000000)

type OffsetMS = number | ((message: Combinable) => number)
type IteratorPayload = AsyncIterableIterator<Combinable>[] | { stream: AsyncIterableIterator<Combinable>; offsetMS: OffsetMS }[]
type CombinedMessage<T> = T extends AsyncIterableIterator<infer U>[]
  ? U
  : T extends { stream: AsyncIterableIterator<infer U> }[]
    ? U
    : never

async function nextWithIndex(
  iterator: AsyncIterableIterator<Combinable> | { stream: AsyncIterableIterator<Combinable>; offsetMS: OffsetMS },
  index: number
): Promise<NextMessageResultWithIndex> {
  if ('offsetMS' in iterator) {
    const result = await iterator.stream.next()

    if (!result.done) {
      const offsetMS = typeof iterator.offsetMS === 'function' ? iterator.offsetMS(result.value) : iterator.offsetMS

      if (offsetMS !== 0) {
        result.value.localTimestamp.setUTCMilliseconds(result.value.localTimestamp.getUTCMilliseconds() + offsetMS)
      }
    }

    return {
      result,
      index
    }
  } else {
    const result = await iterator.next()

    return {
      result,
      index
    }
  }
}

function findOldestResult(oldest: NextMessageResultWithIndex, current: NextMessageResultWithIndex) {
  if (oldest.result.done) {
    return oldest
  }

  if (current.result.done) {
    return current
  }

  const currentTimestamp = current.result.value.localTimestamp.valueOf()
  const oldestTimestamp = oldest.result.value.localTimestamp.valueOf()

  if (currentTimestamp < oldestTimestamp) {
    return current
  }

  if (currentTimestamp === oldestTimestamp) {
    const currentTimestampMicroSeconds = current.result.value.localTimestamp.μs || 0
    const oldestTimestampMicroSeconds = oldest.result.value.localTimestamp.μs || 0

    if (currentTimestampMicroSeconds < oldestTimestampMicroSeconds) {
      return current
    }
  }

  return oldest
}

// combines multiple iterators from for example multiple exchanges
// works both for real-time and historical data
export function combine<T extends IteratorPayload>(...iteratorsPayload: T): AsyncIterableIterator<CombinedMessage<T>> {
  const iterators = iteratorsPayload.map((payload) => {
    if ('stream' in payload) {
      return payload.stream
    }
    return payload
  })
  if (isManagedRealTimeIterator(iterators[0])) {
    return mergeRealTime(iterators) as AsyncIterableIterator<CombinedMessage<T>>
  }

  return combineHistorical(iteratorsPayload) as AsyncIterableIterator<CombinedMessage<T>>
}

async function* combineHistorical(
  iterators: AsyncIterableIterator<Combinable>[] | { stream: AsyncIterableIterator<Combinable>; offsetMS: OffsetMS }[]
) {
  if (iterators.length === 0) {
    return
  }

  try {
    // wait for all results to resolve
    const results = await Promise.all(iterators.map(nextWithIndex))
    let aliveIteratorsCount = results.length
    do {
      // if we're dealing with historical data replay
      // and need to return combined messages iterable sorted by local timestamp in ascending order

      // find resolved one that is the 'oldest'
      const oldestResult = results.reduce(findOldestResult, results[0])
      const { result, index } = oldestResult

      if (result.done) {
        aliveIteratorsCount--

        // we don't want finished iterators to every be considered 'oldest' again
        // hence provide them with result that has local timestamp set to DATE_MAX
        // and that is not done

        results[index].result = {
          done: false,
          value: {
            localTimestamp: DATE_MAX
          }
        }
      } else {
        // yield oldest value and replace with next value from iterable for given index
        yield result.value
        results[index] = await nextWithIndex(iterators[index], index)
      }
    } while (aliveIteratorsCount > 0)
  } finally {
    await Promise.all(iterators.map((iterator) => closeIterator('stream' in iterator ? iterator.stream : iterator)))
  }
}
