import { getFilters, normalizeMessages } from './handy'
import { MapperFactory } from './mappers'
import { createRealTimeFeed } from './realtimefeeds'
import { Disconnect, Exchange, Filter, FilterForExchange } from './types'

export async function* stream<T extends Exchange, U extends boolean = false>({
  exchange,
  filters,
  timeoutIntervalMS = 10000,
  withDisconnects = undefined
}: StreamOptions<T, U>): AsyncIterableIterator<
  U extends true ? { localTimestamp: Date; message: any } | undefined : { localTimestamp: Date; message: any }
> {
  validateStreamOptions(filters)

  const realTimeFeed = createRealTimeFeed(exchange)

  if (timeoutIntervalMS > 0) {
    realTimeFeed.setTimeoutInterval(timeoutIntervalMS)
  }

  const realTimeMessages = realTimeFeed.stream(filters as any)

  for await (const message of realTimeMessages) {
    if (message !== undefined) {
      yield {
        localTimestamp: new Date(),
        message
      } as any
    } else if (withDisconnects) {
      yield undefined as any
    }
  }
}

export function streamNormalized<T extends Exchange, U extends MapperFactory<T, any>[], Z extends boolean = false>(
  { exchange, symbols, timeoutIntervalMS = 10000, withDisconnectMessages = undefined }: StreamNormalizedOptions<T, Z>,
  ...normalizers: U
): AsyncIterableIterator<
  Z extends true
    ? (U extends MapperFactory<infer _, infer X>[] ? X | Disconnect : never)
    : (U extends MapperFactory<infer _, infer X>[] ? X : never)
> {
  // mappers assume that symbols are uppercased by default
  // if user by mistake provide lowercase one let's automatically fix it
  if (symbols !== undefined) {
    symbols = symbols.map(s => s.toUpperCase())
  }

  const createMappers = () => normalizers.map(m => m(exchange))
  const filters = getFilters(createMappers(), symbols)

  const messages = stream({
    exchange,
    withDisconnects: true,
    timeoutIntervalMS,
    filters
  })

  return normalizeMessages(exchange, messages, createMappers, symbols, withDisconnectMessages)
}

function validateStreamOptions(filters: Filter<string>[]) {
  if (!filters) {
    throw new Error(`Invalid "filters" argument. Please provide filters array`)
  }

  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i]

    if (filter.symbols && Array.isArray(filter.symbols) === false) {
      throw new Error(`Invalid "filters[].symbols" argument: ${filter.symbols}. Please provide array of symbol strings`)
    }
  }
}

export type StreamOptions<T extends Exchange, U extends boolean = false> = {
  exchange: T
  filters: FilterForExchange[T][]
  timeoutIntervalMS?: number
  withDisconnects?: U
}

export type StreamNormalizedOptions<T extends Exchange, U extends boolean = false> = {
  exchange: T
  symbols?: string[]
  timeoutIntervalMS?: number
  withDisconnectMessages?: U
}
