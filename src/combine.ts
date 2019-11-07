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

  const firstReceivedMessage = await iterators[0].next()
  const now = new Date()
  const THREE_MINUTES_IN_MS = 3 * 60 * ONE_SEC_IN_MS

  // based on local timestamp of first message decide if iterators provide is real time data
  // if first message is less than three minutes 'old' in comparison to current time
  // alternative would be to provide it via param to combine fn
  const isRealTime = firstReceivedMessage.value.localTimestamp.valueOf() + THREE_MINUTES_IN_MS > now.valueOf()

  if (isRealTime) {
    yield firstReceivedMessage.value as any

    const buffer = new PassThrough({
      objectMode: true,
      highWaterMark: 1024
    })

    const writeMessagesToBuffer = iterators.map(async messages => {
      for await (const message of messages) {
        if (!buffer.write(message))
          //Handle backpressure on write
          await once(buffer, 'drain')
      }
    })

    for await (const message of buffer as any) {
      yield message
    }

    await writeMessagesToBuffer
  } else {
    const nextResults = iterators.map(nextWithIndex)
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
        yield result.value as any
        results[index] = await nextWithIndex(iterators[index], index)
      }
    } while (aliveIteratorsCount > 0)
  }
}
