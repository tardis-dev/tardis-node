import { BoundedQueue } from './boundedqueue.ts'

const REAL_TIME_BUFFER_CAPACITY = 8096
const managedRealTimeIterators = new WeakSet<object>()

export type ManagedRealTimeIterator<T> = AsyncIterableIterator<T> & {
  return: (value?: any) => Promise<IteratorResult<T>>
  [Symbol.asyncDispose](): Promise<void>
  [Symbol.asyncIterator](): ManagedRealTimeIterator<T>
}

export function createManagedRealTimeIterator<T>(
  iterator: AsyncIterableIterator<T>,
  closeSource: () => unknown
): ManagedRealTimeIterator<T> {
  const closeSourceOnce = onceAsync(closeSource)
  const returnOnce = onceAsync(async (value?: any) => {
    const sourceClosed = closeSourceOnce()
    const iteratorReturned = iterator.return === undefined ? Promise.resolve({ done: true as const, value }) : iterator.return(value)
    const [, result] = await Promise.all([sourceClosed, iteratorReturned])
    return result
  })

  const managedIterator: ManagedRealTimeIterator<T> = {
    [Symbol.asyncIterator]() {
      return this
    },
    next(value?: any) {
      return iterator.next(value)
    },
    return(value?: any) {
      // Generator return() waits behind a pending next(), so unblock the source first.
      return returnOnce(value)
    },
    async [Symbol.asyncDispose]() {
      await returnOnce()
    }
  }

  managedRealTimeIterators.add(managedIterator)
  return managedIterator
}

export async function closeIterator(iterator: AsyncIterator<unknown>) {
  await iterator.return?.()
}

export function isManagedRealTimeIterator(iterator: unknown): iterator is ManagedRealTimeIterator<unknown> {
  return (typeof iterator === 'object' && iterator !== null) || typeof iterator === 'function'
    ? managedRealTimeIterators.has(iterator)
    : false
}

export function mergeRealTime<T>(sources: AsyncIterable<T>[]): ManagedRealTimeIterator<T> {
  const output = new BoundedQueue<T>(REAL_TIME_BUFFER_CAPACITY)
  const iterators = sources.map((source) => source[Symbol.asyncIterator]())
  const closeSources = onceAsync(async () => {
    output.close()
    await Promise.allSettled(iterators.map(closeIterator))
  })

  return createManagedRealTimeIterator(merge(iterators, output, closeSources), closeSources)
}

async function* merge<T>(iterators: AsyncIterator<T>[], output: BoundedQueue<T>, closeSources: () => Promise<unknown>) {
  let activeWriters = iterators.length

  const writers = iterators.map(async (iterator) => {
    try {
      while (output.isOpen) {
        const result = await iterator.next()
        if (result.done) {
          return
        }

        const written = output.write(result.value)
        if (written !== true && (await written) === false) {
          return
        }
      }
    } catch (error) {
      if (output.isOpen) {
        output.fail(error instanceof Error ? error : new Error(String(error)))
        void closeSources()
      }
    } finally {
      activeWriters--
      if (activeWriters === 0) {
        output.finish()
      }
    }
  })

  if (writers.length === 0) {
    output.finish()
  }

  try {
    while (true) {
      const result = await output.next()
      if (result.done) {
        return
      }
      yield result.value
    }
  } finally {
    await closeSources()
    await Promise.allSettled(writers)
  }
}

function onceAsync<TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) {
  let promise: Promise<Awaited<TResult>> | undefined
  return (...args: TArgs) => {
    if (promise === undefined) {
      try {
        promise = Promise.resolve(callback(...args))
      } catch (error) {
        promise = Promise.reject(error)
      }
    }
    return promise
  }
}
