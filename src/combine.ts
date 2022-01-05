import { PassThrough } from 'stream'
import { once } from 'events'

type NextMessageResultWithIndex = {
  index: number
  result: IteratorResult<Combinable, Combinable>
}

type Combinable = { localTimestamp: Date }

const DATE_MAX = new Date(8640000000000000)

type OffsetMS = number | ((message: Combinable) => number)

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
export async function* combine<
  T extends AsyncIterableIterator<Combinable>[] | { stream: AsyncIterableIterator<Combinable>; offsetMS: OffsetMS }[]
>(
  ...iteratorsPayload: T
): AsyncIterableIterator<
  T extends AsyncIterableIterator<infer U>[] ? U : T extends { stream: AsyncIterableIterator<infer Z> }[] ? Z : never
> {
  const iterators = iteratorsPayload.map((payload) => {
    if ('stream' in payload) {
      return payload.stream
    }
    return payload
  })

  if (iterators.length === 0) {
    return
  }
  // decide based on first provided iterator if we're dealing with real-time or historical data streams
  if ((iterators[0] as any).__realtime__) {
    const combinedStream = new PassThrough({
      objectMode: true,
      highWaterMark: 8096
    })

    iterators.forEach(async function writeMessagesToCombinedStream(messages) {
      for await (const message of messages) {
        if (combinedStream.destroyed) {
          return
        }

        if (!combinedStream.write(message)) {
          // Handle backpressure on write
          await once(combinedStream, 'drain')
        }
      }
    })

    for await (const message of combinedStream) {
      yield message
    }
  } else {
    return yield* combineHistorical(iteratorsPayload) as any
  }
}

async function* combineHistorical(
  iterators: AsyncIterableIterator<Combinable>[] | { stream: AsyncIterableIterator<Combinable>; offsetMS: OffsetMS }[]
) {
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
    for (let iterator of iterators) {
      ;(iterator as any).return()
    }
  }
}
