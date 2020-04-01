import { createHash } from 'crypto'
import { Mapper } from './mappers'
import { Disconnect, Exchange, FilterForExchange, Filter } from './types'

export function parseAsUTCDate(val: string) {
  // not sure about this one, but it should force parsing date as UTC date not as local timezone
  if (val.endsWith('Z') === false) {
    val += 'Z'
  }
  var date = new Date(val)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()))
}

export function wait(delayMS: number) {
  return new Promise((resolve) => {
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

export function doubleDigit(input: number) {
  return input < 10 ? '0' + input : '' + input
}

export function sha256(obj: object) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000)
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 60000 * 1440)
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

export function* take(iterable: Iterable<any>, length: number) {
  if (length === 0) {
    return
  }
  for (const item of iterable) {
    yield item
    length--

    if (length === 0) {
      return
    }
  }
}

export async function* normalizeMessages(
  exchange: Exchange,
  messages: AsyncIterableIterator<{ localTimestamp: Date; message: any } | undefined>,
  mappers: Mapper<any, any>[],
  createMappers: (localTimestamp: Date) => Mapper<any, any>[],
  withDisconnectMessages: boolean | undefined,
  filter?: (symbol: string) => boolean,
  currentTimestamp?: Date | undefined
) {
  let previousLocalTimestamp: Date | undefined = currentTimestamp
  let mappersForExchange: Mapper<any, any>[] | undefined = mappers
  if (mappersForExchange.length === 0) {
    throw new Error(`Can't normalize data without any normalizers provided`)
  }

  for await (const messageWithTimestamp of messages) {
    if (messageWithTimestamp === undefined) {
      // we received undefined meaning Websocket disconnection
      // lets create new mappers with clean state for 'new connection'
      mappersForExchange = undefined

      // if flag withDisconnectMessages is set, yield disconnect message
      if (withDisconnectMessages === true && previousLocalTimestamp !== undefined) {
        const disconnect: Disconnect = {
          type: 'disconnect',
          exchange,
          localTimestamp: previousLocalTimestamp
        }
        yield disconnect as any
      }

      continue
    }

    if (mappersForExchange === undefined) {
      mappersForExchange = createMappers(messageWithTimestamp.localTimestamp)
    }

    previousLocalTimestamp = messageWithTimestamp.localTimestamp

    for (const mapper of mappersForExchange) {
      if (mapper.canHandle(messageWithTimestamp.message)) {
        const mappedMessages = mapper.map(messageWithTimestamp.message, messageWithTimestamp.localTimestamp)
        if (!mappedMessages) {
          continue
        }

        for (const message of mappedMessages) {
          if (filter === undefined) {
            yield message
          } else if (filter(message.symbol)) {
            yield message
          }
        }
      }
    }
  }
}

export function getFilters<T extends Exchange>(mappers: Mapper<T, any>[], symbols?: string[]) {
  const filters = mappers.flatMap((mapper) => mapper.getFilters(symbols))

  const deduplicatedFilters = filters.reduce((prev, current) => {
    const matchingExisting = prev.find((c) => c.channel === current.channel)
    if (matchingExisting !== undefined) {
      if (matchingExisting.symbols !== undefined && current.symbols) {
        for (let symbol of current.symbols) {
          if (matchingExisting.symbols.includes(symbol) === false) {
            matchingExisting.symbols.push(symbol)
          }
        }
      } else if (current.symbols) {
        matchingExisting.symbols = [...current.symbols]
      }
    } else {
      prev.push(current)
    }

    return prev
  }, [] as FilterForExchange[T][])

  return deduplicatedFilters
}

export function* batch(symbols: string[], batchSize: number) {
  for (let i = 0; i < symbols.length; i += batchSize) {
    yield symbols.slice(i, i + batchSize)
  }
}

export function parseμs(dateString: string): number {
  // check if we have ISO 8601 format date string, e.g: 2019-06-01T00:03:03.1238784Z
  // or 2020-03-01T00:00:24.893456+00:00
  if (dateString.length === 28 || dateString.length === 32) {
    return Number(dateString.slice(23, 26))
  }

  return 0
}

export function optimizeFilters(filters: Filter<any>[]) {
  // deduplicate filters (if the channel was provided multiple times)
  const optimizedFilters = filters.reduce((prev, current) => {
    const matchingExisting = prev.find((c) => c.channel === current.channel)

    if (matchingExisting) {
      // both previous and current have symbols let's merge them
      if (matchingExisting.symbols && current.symbols) {
        matchingExisting.symbols.push(...current.symbols)
      } else if (current.symbols) {
        matchingExisting.symbols = [...current.symbols]
      }
    } else {
      prev.push(current)
    }

    return prev
  }, [] as Filter<any>[])

  // sort filters in place to improve local disk cache ratio (no matter filters order if the same filters are provided will hit the cache)
  optimizedFilters.sort((f1, f2) => {
    if (f1.channel < f2.channel) {
      return -1
    }

    if (f1.channel > f2.channel) {
      return 1
    }

    return 0
  })

  // sort and deduplicate filters symbols
  optimizedFilters.forEach((filter) => {
    if (filter.symbols) {
      filter.symbols = [...new Set(filter.symbols)].sort()
    }
  })

  return optimizedFilters
}
