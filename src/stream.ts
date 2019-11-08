import { debug } from './debug'
import { getFilters, normalizeMessages, wait } from './handy'
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

  let retries = 0
  while (true) {
    try {
      const realTimeFeed = createRealTimeFeed(exchange, filters, timeoutIntervalMS)

      for await (const message of realTimeFeed) {
        yield {
          localTimestamp: new Date(),
          message
        } as any
        if (retries > 0) {
          // reset retries counter as we've received correct message from the connection
          retries = 0
        }
      }

      if (withDisconnects) {
        // if loop has ended it means that websocket connection has been closed
        //  so notify about it by yielding undefined if flag is set
        yield undefined as any
      }
    } catch (error) {
      retries++
      const isRateLimited = error.message.includes('429')
      const expontent = isRateLimited ? retries + 4 : retries - 1
      let delay = Math.pow(2, expontent) * 1000
      const MAX_DELAY = 32 * 1000
      if (delay > MAX_DELAY) {
        delay = MAX_DELAY
      }

      debug(
        '%s real-time feed connection error, retries count: %d, next retry delay: %dms, error message: %o',
        exchange,
        retries,
        delay,
        error
      )

      if (withDisconnects) {
        yield undefined as any
      }

      await wait(delay)
    }
  }
}

export async function* streamNormalized<T extends Exchange, U extends MapperFactory<T, any>[], Z extends boolean = false>(
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

  while (true) {
    try {
      const createMappers = (localTimestamp: Date) => normalizers.map(m => m(exchange, localTimestamp))
      const mappers = createMappers(new Date())
      const filters = getFilters(mappers, symbols)

      const messages = stream({
        exchange,
        withDisconnects: true,
        timeoutIntervalMS,
        filters
      })

      const normalizedMessages = normalizeMessages(exchange, messages, mappers, createMappers, withDisconnectMessages)
      for await (const message of normalizedMessages) {
        yield message
      }
    } catch (error) {
      debug('%s normalize messages error: %o, retrying with new connection...', exchange, error)
      if (withDisconnectMessages) {
        // yield it as disconnect as well if flag is set
        const disconnect: Disconnect = {
          type: 'disconnect',
          exchange,
          localTimestamp: new Date()
        }

        yield disconnect as any
      }
    }
  }
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
