import { debug } from './debug'
import { getFilters, normalizeMessages } from './handy'
import { MapperFactory } from './mappers'
import { createRealTimeFeed } from './realtimefeeds'
import { Disconnect, Exchange, Filter, FilterForExchange } from './types'

async function* _stream<T extends Exchange, U extends boolean = false>({
  exchange,
  filters,
  timeoutIntervalMS = 10000,
  withDisconnects = undefined,
  onError = undefined
}: StreamOptions<T, U>): AsyncIterableIterator<
  U extends true ? { localTimestamp: Date; message: any } | undefined : { localTimestamp: Date; message: any }
> {
  validateStreamOptions(filters)

  const realTimeFeed = createRealTimeFeed(exchange, filters, timeoutIntervalMS, onError)

  for await (const message of realTimeFeed) {
    if (message.__disconnect__ === true) {
      // __disconnect__ message means that websocket connection has been closed
      // notify about it by yielding undefined if flag is set
      if (withDisconnects) {
        yield undefined as any
      }
    } else {
      yield {
        localTimestamp: new Date(),
        message
      } as any
    }
  }
}

export function stream<T extends Exchange, U extends boolean = false>({
  exchange,
  filters,
  timeoutIntervalMS = 10000,
  withDisconnects = undefined,
  onError = undefined
}: StreamOptions<T, U>): AsyncIterableIterator<
  U extends true ? { localTimestamp: Date; message: any } | undefined : { localTimestamp: Date; message: any }
> {
  let _iterator = _stream({ exchange, filters, timeoutIntervalMS, withDisconnects, onError })

  ;(_iterator as any).__realtime__ = true

  return _iterator
}

async function* _streamNormalized<T extends Exchange, U extends MapperFactory<T, any>[], Z extends boolean = false>(
  { exchange, symbols, timeoutIntervalMS = 10000, withDisconnectMessages = undefined, onError = undefined }: StreamNormalizedOptions<T, Z>,
  ...normalizers: U
): AsyncIterableIterator<
  Z extends true
    ? U extends MapperFactory<infer _, infer X>[]
      ? X | Disconnect
      : never
    : U extends MapperFactory<infer _, infer X>[]
    ? X
    : never
> {
  while (true) {
    try {
      const createMappers = (localTimestamp: Date) => normalizers.map((m) => m(exchange, localTimestamp))
      const mappers = createMappers(new Date())
      const filters = getFilters(mappers, symbols)

      const messages = _stream({
        exchange,
        withDisconnects: true,
        timeoutIntervalMS,
        filters,
        onError
      })

      // filter normalized messages by symbol as some exchanges do not offer subscribing to specific symbols for some of the channels
      // for example Phemex market24h channel

      const upperCaseSymbols = symbols !== undefined ? symbols.map((s) => s.toUpperCase()) : undefined
      const filter = (symbol: string) => {
        return upperCaseSymbols === undefined || upperCaseSymbols.length === 0 || upperCaseSymbols.includes(symbol)
      }

      const normalizedMessages = normalizeMessages(exchange, messages, mappers, createMappers, withDisconnectMessages, filter, new Date())

      for await (const message of normalizedMessages) {
        yield message
      }
    } catch (error: any) {
      if (onError !== undefined) {
        onError(error)
      }
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
  onError?: (error: Error) => void
}

export type StreamNormalizedOptions<T extends Exchange, U extends boolean = false> = {
  exchange: T
  symbols?: string[]
  timeoutIntervalMS?: number
  withDisconnectMessages?: U
  onError?: (error: Error) => void
}

export function streamNormalized<T extends Exchange, U extends MapperFactory<T, any>[], Z extends boolean = false>(
  { exchange, symbols, timeoutIntervalMS = 10000, withDisconnectMessages = undefined, onError = undefined }: StreamNormalizedOptions<T, Z>,
  ...normalizers: U
): AsyncIterableIterator<
  Z extends true
    ? U extends MapperFactory<infer _, infer X>[]
      ? X | Disconnect
      : never
    : U extends MapperFactory<infer _, infer X>[]
    ? X
    : never
> {
  let _iterator = _streamNormalized({ exchange, symbols, timeoutIntervalMS, withDisconnectMessages, onError }, ...normalizers)

  ;(_iterator as any).__realtime__ = true

  return _iterator
}
