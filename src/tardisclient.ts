import os from 'os'
import path from 'path'
import zlib from 'zlib'
import { Worker } from 'worker_threads'
import got from 'got'
import dbg from 'debug'
import { createReadStream, remove } from 'fs-extra'

import { EXCHANGES, EXCHANGE_CHANNELS_INFO } from './consts'
import { parseAsUTCDate, wait } from './handy'
import { WorkerMessage, WorkerJobPayload } from './worker'
import { BinarySplitStream } from './binarysplit'
import { DataType, MessageForDataType, Message, FilterForExchange, Exchange } from './types'
import { createMapper } from './mappers'
import { createRealTimeFeed } from './realtimefeeds'

const debug = dbg('tardis-client')

export class TardisClient {
  private static _defaultOptions: Options = {
    endpoint: 'https://tardis.dev/api',
    cacheDir: path.join(os.tmpdir(), '.tardis-cache'),
    apiKey: ''
  }

  private _options: Options

  constructor(options: Partial<Omit<Options, 'endpoint'>> = {}) {
    this._options = { ...TardisClient._defaultOptions, ...options }

    debug('initialized with: %o', this._options)
  }

  public async clearCache() {
    const dirToRemove = `${this._options.cacheDir}`

    try {
      debug('clearing cache dir: %s', dirToRemove)

      await remove(dirToRemove)

      debug('cleared cache dir: %s', dirToRemove)
    } catch (e) {
      debug('clearing cache dir error: %o', e)
    }
  }

  public async getExchangeDetails<T extends Exchange>(exchange: T) {
    const exchangeDetails = await got.get(`${this._options.endpoint}/v1/exchanges/${exchange}`).json()

    return exchangeDetails as ExchangeDetails<T>
  }

  public async getApiKeyAccessInfo() {
    const apiKeyAccessInfo = await got
      .get(`${this._options.endpoint}/v1/api-key-info`, {
        headers: {
          Authorization: `Bearer ${this._options.apiKey}`
        }
      })
      .json()

    return apiKeyAccessInfo as ApiKeyAccessInfo
  }

  public async *replay<T extends Exchange, U extends boolean = false, Z extends boolean = false>({
    exchange,
    from,
    to,
    filters,
    skipDecoding = undefined,
    returnDisconnectsAsUndefined = undefined
  }: ReplayOptions<T, U, Z>): AsyncIterableIterator<
    Z extends true
      ? U extends true
        ? { localTimestamp: Buffer; message: Buffer } | undefined
        : { localTimestamp: Date; message: any } | undefined
      : U extends true
      ? { localTimestamp: Buffer; message: Buffer }
      : { localTimestamp: Date; message: any }
  > {
    this._validateReplayOptions(exchange, from, to, filters)

    const fromDate = parseAsUTCDate(from)
    const toDate = parseAsUTCDate(to)
    const cachedSlicePaths = new Map<string, string>()
    let workerError
    debug(
      'replay for exchange: %s started - from: %s, to: %s, filters: %o',
      exchange,
      fromDate.toISOString(),
      toDate.toISOString(),
      filters
    )

    // initialize worker thread that will fetch and cache data feed slices and "report back" by setting proper key/values in cachedSlicePaths
    const payload: WorkerJobPayload = {
      cacheDir: this._options.cacheDir,
      endpoint: this._options.endpoint,
      apiKey: this._options.apiKey,
      fromDate,
      toDate,
      exchange,
      filters: filters || []
    }

    const worker = new Worker(path.resolve(__dirname, 'worker.js'), {
      workerData: payload
    })

    worker.on('message', (message: WorkerMessage) => {
      cachedSlicePaths.set(message.sliceKey, message.slicePath)
    })

    worker.on('error', err => {
      debug('worker error %o', err)

      workerError = err
    })

    worker.on('exit', code => {
      debug('worker finished with code: %d', code)
    })
    // this helper flag helps us not yielding two subsequent undefined/disconnect messages
    let lastMessageWasUndefined = false

    let currentSliceDate = new Date(fromDate)
    // iterate over every minute in <=from,to> date range
    // get cached slice paths, read them as file streams, decompress, split by new lines and yield as messages
    while (currentSliceDate < toDate) {
      const sliceKey = currentSliceDate.toISOString()

      debug('getting slice: %s, exchange: %s', sliceKey, exchange)

      let cachedSlicePath
      while (cachedSlicePath === undefined) {
        cachedSlicePath = cachedSlicePaths.get(sliceKey)

        // if something went wrong with worker throw error it has returned (network issue, auth issue etc)
        if (workerError !== undefined) {
          throw workerError
        }

        if (cachedSlicePath === undefined) {
          // if response for requested date is not ready yet wait 100ms and try again
          debug('waiting for slice: %s, exchange: %s', sliceKey, exchange)
          await wait(100)
        }
      }

      // response is a path to file on disk let' read it as stream
      const linesStream = createReadStream(cachedSlicePath, { highWaterMark: 128 * 1024 })
        // unzip it
        .pipe(zlib.createGunzip({ chunkSize: 128 * 1024 }))
        // and split by new line
        .pipe(new BinarySplitStream())

      let linesCount = 0
      // date is always formatted to have lendth of 28 so we can skip looking for first space in line and use it
      // as hardcoded value
      const DATE_MESSAGE_SPLIT_INDEX = 28

      for await (const line of linesStream) {
        const bufferLine = line as Buffer
        linesCount++
        if (bufferLine.length > 0) {
          lastMessageWasUndefined = false
          const localTimestampBuffer = bufferLine.slice(0, DATE_MESSAGE_SPLIT_INDEX)
          const messageBuffer = bufferLine.slice(DATE_MESSAGE_SPLIT_INDEX + 1)
          // as any due to https://github.com/Microsoft/TypeScript/issues/24929
          if (skipDecoding === true) {
            yield {
              localTimestamp: localTimestampBuffer,
              message: messageBuffer
            } as any
          } else {
            yield {
              // when skipDecoding is not set, decode timestamp to Date and message to object
              localTimestamp: new Date(localTimestampBuffer.toString()),
              message: JSON.parse(messageBuffer as any)
            } as any
          }
          // ignore empty lines unless returnDisconnectsAsUndefined is set to true
          // do not yield subsequent undefined messages
        } else if (returnDisconnectsAsUndefined === true && lastMessageWasUndefined === false) {
          lastMessageWasUndefined = true
          yield undefined as any
        }
      }
      // if slice was empty (no lines at all) yield undefined if flag is set
      // do not yield subsequent undefined messages eg: two empty slices produce single undefined/disconnect message
      if (linesCount === 0 && returnDisconnectsAsUndefined === true && lastMessageWasUndefined === false) {
        lastMessageWasUndefined = true
        yield undefined as any
      }

      debug('processed slice: %s, exchange: %s, count: %d', sliceKey, exchange, linesCount)

      // remove slice key from the map as it's already processed
      cachedSlicePaths.delete(sliceKey)
      // move one minute forward
      currentSliceDate.setUTCMinutes(currentSliceDate.getUTCMinutes() + 1)
    }

    debug(
      'replay for exchange: %s finished - from: %s, to: %s, filters: %o',
      exchange,
      fromDate.toISOString(),
      toDate.toISOString(),
      filters
    )
  }

  public async *replayNormalized<T extends DataType | DataType[], U extends boolean = false>({
    exchange,
    from,
    to,
    symbols,
    returnDisconnectsAsUndefined = undefined,
    dataTypes
  }: ReplayNormalizedOptions<T, U>): AsyncIterableIterator<
    T extends DataType
      ? (U extends true ? MessageForDataType[T] | undefined : MessageForDataType[T])
      : (U extends true ? Message | undefined : Message)
  > {
    let mapper = createMapper(exchange)
    // mappers assume that symbols are uppercased by default
    // if user by mistake provide lowercase one let's automatically fix it
    if (symbols !== undefined) {
      symbols = symbols.map(s => s.toUpperCase())
    }

    const dateTypesToMap = (Array.isArray(dataTypes) ? dataTypes : [dataTypes]) as DataType[]
    const nonFilterableExchanges = ['bitfinex', 'bitfinex-derivatives']
    const filters = nonFilterableExchanges.includes(exchange)
      ? []
      : dateTypesToMap.flatMap<FilterForExchange[typeof exchange]>(dt => mapper.getFiltersForDataTypeAndSymbols(dt, symbols) as any)

    const messages = this.replay({
      exchange,
      from,
      to,
      returnDisconnectsAsUndefined: true,
      filters
    })

    // we need to apply filtering on the client as well as some of the exchanges may not provide server-side filtering (eg.bitfinex)
    const symbolsInclude = (symbol: string) => symbols === undefined || symbols.length == 0 || symbols.includes(symbol)

    for await (const messageWithTimestamp of messages) {
      if (messageWithTimestamp === undefined) {
        // we received undefined meaning Websocket disconnection when recording the data
        // lets create new mapper with clean state for 'new connection'
        mapper = createMapper(exchange)

        // if flag returnDisconnectsAsUndefined is set yield undefined
        if (returnDisconnectsAsUndefined === true) {
          yield undefined as any
        }
        continue
      }

      const mappedMessages = mapper.map(messageWithTimestamp.message, messageWithTimestamp.localTimestamp)
      if (!mappedMessages) {
        continue
      }

      for (const message of mappedMessages) {
        if (symbolsInclude(message.symbol)) {
          yield message as any
        }
      }
    }
  }

  public async *stream<T extends Exchange, U extends boolean = false>({
    exchange,
    filters,
    timeoutIntervalMS = 10000,
    returnDisconnectsAsUndefined = undefined
  }: StreamOptions<T, U>): AsyncIterableIterator<
    U extends true ? { localTimestamp: Date; message: any } | undefined : { localTimestamp: Date; message: any }
  > {
    this._validateStreamOptions(exchange, filters)

    const realTimeFeed = createRealTimeFeed(exchange)

    if (timeoutIntervalMS > 0) {
      realTimeFeed.setTimeoutInterval(timeoutIntervalMS)
    }

    debug('real-time feed for exchange: %s started, filters: %o', exchange, filters)

    const realTimeMessages = realTimeFeed.stream(filters as any)

    for await (const message of realTimeMessages) {
      if (message !== undefined) {
        yield {
          localTimestamp: new Date(),
          message
        } as any
      } else if (returnDisconnectsAsUndefined) {
        yield undefined as any
      }
    }
  }

  public async *streamNormalized<T extends DataType | DataType[], U extends boolean = false>({
    exchange,
    symbols,
    timeoutIntervalMS = 10000,
    returnDisconnectsAsUndefined = undefined,
    dataTypes
  }: StreamNormalizedOptions<T, U>): AsyncIterableIterator<
    T extends DataType
      ? (U extends true ? MessageForDataType[T] | undefined : MessageForDataType[T])
      : (U extends true ? Message | undefined : Message)
  > {
    let mapper = createMapper(exchange)
    // mappers assume that symbols are uppercased by default
    // if user by mistake provide lowercase one let's automatically fix it
    if (symbols !== undefined) {
      symbols = symbols.map(s => s.toUpperCase())
    }

    const dateTypesToMap = (Array.isArray(dataTypes) ? dataTypes : [dataTypes]) as DataType[]

    const filters = dateTypesToMap.flatMap<FilterForExchange[typeof exchange]>(
      dt => mapper.getFiltersForDataTypeAndSymbols(dt, symbols) as any
    )

    const messages = this.stream({
      exchange,
      returnDisconnectsAsUndefined: true,
      timeoutIntervalMS,
      filters
    })

    for await (const messageWithTimestamp of messages) {
      if (messageWithTimestamp === undefined) {
        // we received undefined meaning Websocket disconnection when recording the data
        // lets create new mapper with clean state for 'new connection'
        mapper = createMapper(exchange)

        // if flag returnDisconnectsAsUndefined is set yield undefined
        if (returnDisconnectsAsUndefined === true) {
          yield undefined as any
        }

        continue
      }

      const mappedMessages = mapper.map(messageWithTimestamp.message, messageWithTimestamp.localTimestamp)

      if (!mappedMessages) {
        continue
      }

      for (const message of mappedMessages) {
        if (dataTypes.includes(message.type)) {
          yield message as any
        }
      }
    }
  }

  private _validateReplayOptions<T extends Exchange>(exchange: T, from: string, to: string, filters: FilterForExchange[T][]) {
    if (!exchange || EXCHANGES.includes(exchange) === false) {
      throw new Error(`Invalid "exchange" argument: ${exchange}. Please provide one of the following exchanges: ${EXCHANGES.join(', ')}.`)
    }

    if (!from || isNaN(Date.parse(from))) {
      throw new Error(`Invalid "from" argument: ${from}. Please provide valid date string.`)
    }

    if (!to || isNaN(Date.parse(to))) {
      throw new Error(`Invalid "to" argument: ${to}. Please provide valid date string.`)
    }

    if (parseAsUTCDate(to) < parseAsUTCDate(from)) {
      throw new Error(`Invalid "to" and "from" arguments combination. Please provide "to" date that is later than "from" date.`)
    }

    if (filters && filters.length > 0) {
      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i]

        if (!filter.channel || (EXCHANGE_CHANNELS_INFO[exchange] as any).includes(filter.channel) === false) {
          throw new Error(
            `Invalid "filters[].channel" argument: ${
              filter.channel
            }. Please provide one of the following channels: ${EXCHANGE_CHANNELS_INFO[exchange].join(', ')}.`
          )
        }

        if (filter.symbols && Array.isArray(filter.symbols) === false) {
          throw new Error(`Invalid "filters[].symbols" argument: ${filter.symbols}. Please provide array of symbol strings`)
        }
      }
    }
  }

  private _validateStreamOptions<T extends Exchange>(exchange: T, filters: FilterForExchange[T][]) {
    if (!exchange || EXCHANGES.includes(exchange) === false) {
      throw new Error(`Invalid "exchange" argument: ${exchange}. Please provide one of the following exchanges: ${EXCHANGES.join(', ')}.`)
    }

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
}

type Options = {
  endpoint: string
  cacheDir: string
  apiKey: string
}

export type ReplayOptions<T extends Exchange, U extends boolean = false, Z extends boolean = false> = {
  exchange: T
  from: string
  to: string
  filters: FilterForExchange[T][]
  skipDecoding?: U
  returnDisconnectsAsUndefined?: Z
}

export type ReplayNormalizedOptions<T extends DataType | DataType[], U extends boolean = false> = {
  from: string
  to: string
  exchange: Exchange
  dataTypes: T
  symbols?: string[]
  returnDisconnectsAsUndefined?: U
}

export type StreamOptions<T extends Exchange, U extends boolean = false> = {
  exchange: T
  filters: FilterForExchange[T][]
  timeoutIntervalMS?: number
  returnDisconnectsAsUndefined?: U
}

export type StreamNormalizedOptions<T extends DataType | DataType[], U extends boolean = false> = {
  exchange: Exchange
  dataTypes: T
  timeoutIntervalMS?: number
  symbols?: string[]
  returnDisconnectsAsUndefined?: U
}

export type ExchangeDetails<T extends Exchange> = {
  id: T
  name: string
  enabled: boolean
  filterable: boolean
  availableSince: string
  availableSymbols: {
    id: string
    type: 'spot' | 'future' | 'perpetual' | 'option'
    availableSince: string
    availableTo?: string
  }[]
  availableChannels: FilterForExchange[T]['channel'][]
  incidentReports: {
    from: string
    to: string
    status: string
    details: string
  }
}

export type ApiKeyAccessInfo = {
  exchange: Exchange
  from: string
  to: string
  symbols: string[]
}[]
