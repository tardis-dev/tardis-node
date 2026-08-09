export async function forEachConcurrent<T>(items: Iterable<T>, concurrency: number, action: (item: T) => Promise<unknown>) {
  const iterator = items[Symbol.iterator]()
  let hasError = false
  let firstError: unknown

  const runWorker = async () => {
    while (hasError === false) {
      const next = iterator.next()
      if (next.done) {
        return
      }

      try {
        await action(next.value)
      } catch (error) {
        if (hasError === false) {
          hasError = true
          firstError = error
        }
        return
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()))
  if (hasError) {
    throw firstError
  }
}
