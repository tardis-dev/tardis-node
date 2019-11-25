import { once } from 'events'
import { PassThrough } from 'stream'
import { ONE_SEC_IN_MS } from './handy'

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
    const firstReceivedResult = await iterators[0].next()
    const now = new Date()
    const THREE_MINUTES_IN_MS = 3 * 60 * ONE_SEC_IN_MS

    // based on local timestamp of first message decide if iterators provide is real time data
    // if first message is less than three minutes 'old' in comparison to current time
    // alternative would be to provide isRealtime via param to combine fn, perhaps less magic?...
    const isRealTime = firstReceivedResult.value.localTimestamp.valueOf() + THREE_MINUTES_IN_MS > now.valueOf()

    if (isRealTime) {
      yield firstReceivedResult.value as any

      buffer = new PassThrough({
        objectMode: true,
        highWaterMark: 1024
      })

      iterators.forEach(async messages => {
        for await (const message of messages) {
          if (!buffer!.write(message)) {
            //Handle backpressure on write
            await once(buffer!, 'drain')
          }
        }
      })

      for await (const message of buffer as any) {
        yield message
      }
    } else {
      // first item was already read so we need to 'put it back' as if it wasn't
      const nextResults = [
        Promise.resolve({
          index: 0,
          result: firstReceivedResult
        })
      ]

      // add rest of the items to array we're work with later on
      for (var i = 1; i < iterators.length; i++) {
        nextResults[i] = nextWithIndex(iterators[i], i)
      }

      return yield* combineHistorical(iterators, nextResults) as any
    }
  } finally {
    buffer?.end()

    // clean up - this will close open real-time connections
    for (const iterator of iterators) {
      if (iterator.return !== undefined) {
        iterator.return!()
      }
    }
  }
}

async function* combineHistorical(
  iterators: AsyncIterableIterator<Combinable>[],
  nextResults: Promise<{ index: number; result: IteratorResult<Combinable, any> }>[]
) {
  // wait for all results to resolve
  const results = await Promise.all(nextResults)
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
