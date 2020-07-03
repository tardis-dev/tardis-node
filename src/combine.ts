import { PassThrough } from 'stream'
import { once } from 'events'

type NextMessageResultWitIndex = {
  index: number
  result: IteratorResult<Combinable, Combinable>
}

type Combinable = { localTimestamp: Date }

const DATE_MAX = new Date(8640000000000000)

async function nextWithIndex(iterator: AsyncIterableIterator<Combinable>, index: number): Promise<NextMessageResultWitIndex> {
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

// combines multiple iterators from for example multiple exchanges
// works both for real-time and historical data
export async function* combine<T extends AsyncIterableIterator<Combinable>[]>(
  ...iterators: T
): AsyncIterableIterator<T extends AsyncIterableIterator<infer U>[] ? U : never> {
  if (iterators.length === 0) {
    return
  }
  let buffer: PassThrough | undefined = undefined
  try {
    // decide based on first provided iterator if we're dealing with real-time or historical data streams
    if ((iterators[0] as any).__realtime__) {
      buffer = new PassThrough({
        objectMode: true,
        highWaterMark: 1024
      })

      const writeMessagesToBuffer = iterators.map(async (messages) => {
        for await (const message of messages) {
          if (buffer!.destroyed) {
            return
          }

          if (!buffer!.write(message))
            // Handle backpressure on write
            await once(buffer!, 'drain')
        }
      })

      for await (const message of buffer as any) {
        yield message
      }

      await writeMessagesToBuffer
    } else {
      return yield* combineHistorical(iterators) as any
    }
  } finally {
    if (buffer !== undefined) {
      buffer.destroy()
    }

    //  this will close open real-time connections
    for (const iterator of iterators) {
      if (iterator.return !== undefined) {
        iterator.return!()
      }
    }
  }
}

async function* combineHistorical(iterators: AsyncIterableIterator<Combinable>[]) {
  // wait for all results to resolve
  const results = await Promise.all(iterators.map(nextWithIndex))
  let aliveIteratorsCount = results.length
  do {
    // if we're deailing with historical data replay
    // and need to return combined messages iterable sorted by local timestamp in acending order

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
}
