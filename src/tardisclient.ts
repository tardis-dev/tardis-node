import os from 'os'
import path from 'path'
import zlib from 'zlib'
import { Worker } from 'worker_threads'
import dbg from 'debug'
import { createReadStream, remove } from 'fs-extra'

import { Exchange, FilterForExchange, EXCHANGES, EXCHANGE_CHANNELS_INFO } from './consts'
import { parseAsUTCDate, wait } from './handy'
import { WorkerMessage, WorkerJobPayload } from './worker'
import { BinarySplitStream } from './binarysplit'
import { getMapper, DataType, MessageForDataType, Message } from './mappers'

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

  public async *replay<T extends Exchange, U extends boolean = false, Z extends boolean = false>({
    exchange,
    from,
    to,
    filters = undefined,
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
    this._validateInputs(exchange, from, to, filters)
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

    let currentSliceDate = new Date(fromDate)
    // iterate over every minute in <=from,to> date range
    // get cached slice paths, read them as file streams, decompress, split by new lines and yield as messages
    while (currentSliceDate < toDate) {
      const sliceKey = currentSliceDate.toISOString()

      debug('getting slice: %s, exchange: %s', sliceKey, exchange)

      let cachedSlicePath
      while (!cachedSlicePath) {
        cachedSlicePath = cachedSlicePaths.get(sliceKey)

        // if something went wrong with worker throw error it has returned (network issue, auth issue etc)
        if (workerError) {
          throw workerError
        }

        if (!cachedSlicePath) {
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
          const localTimestampBuffer = bufferLine.slice(0, DATE_MESSAGE_SPLIT_INDEX)
          const messageBuffer = bufferLine.slice(DATE_MESSAGE_SPLIT_INDEX + 1)
          // as any due to https://github.com/Microsoft/TypeScript/issues/24929
          if (skipDecoding) {
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
        } else if (returnDisconnectsAsUndefined) {
          yield undefined as any
        }
      }
      // if slice was empty (no lines at all) yield undefined if flag is set
      if (linesCount == 0 && returnDisconnectsAsUndefined) {
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

  public replayTrades<Z extends boolean = false>(options: ReplayNormalizedOptions<Z>) {
    return this._replayNormalized(options, 'trade')
  }

  public replayOrderBookL2Changes<Z extends boolean = false>(options: ReplayNormalizedOptions<Z>) {
    return this._replayNormalized(options, 'l2change')
  }

  public replayQuotes<Z extends boolean = false>(options: ReplayNormalizedOptions<Z>) {
    return this._replayNormalized(options, 'quote')
  }

  public replayTicker<Z extends boolean = false>(options: ReplayNormalizedOptions<Z>) {
    return this._replayNormalized(options, 'ticker')
  }

  public replayNormalized(options: ReplayNormalizedOptions, dataTypes: DataType[] = ['trade', 'l2change', 'quote', 'ticker']) {
    return this._replayNormalized(options, dataTypes)
  }

  private async *_replayNormalized<T extends DataType | DataType[], Z extends boolean = false>(
    { exchange, from, to, symbols, returnDisconnectsAsUndefined = undefined }: ReplayNormalizedOptions<Z>,
    dataTypes: T
  ): AsyncIterableIterator<
    T extends DataType
      ? (Z extends true ? MessageForDataType[T] | undefined : MessageForDataType[T])
      : (Z extends true ? Message | undefined : Message)
  > {
    const mapper = getMapper(exchange)
    const dateTypesToMap = (Array.isArray(dataTypes) ? dataTypes : [dataTypes]) as DataType[]
    // mappers assume that symbols are uppercased by default
    // if user by mistake provide lowercase one let's automatically fix it
    if (symbols) {
      symbols = symbols.map(s => s.toUpperCase())
    }

    const messages = this.replay({
      exchange,
      from,
      to,
      returnDisconnectsAsUndefined: true,
      filters: dateTypesToMap.flatMap<FilterForExchange[typeof exchange]>(dt => mapper.getFiltersForDataTypeAndSymbols(dt, symbols) as any)
    })

    // we need to apply filtering on the client as well as some of the exchanges may not provide server-side filtering (eg.bitfinex)
    const symbolsInclude = (symbol: string) => !symbols || symbols.includes(symbol)

    for await (const messageWithTimestamp of messages) {
      if (!messageWithTimestamp) {
        // we received undefined meaning Websocket disconnection when recording the data, we may need to clean up
        // some 'state' for the mappers like for example channelid to channel mappings
        // for bitfinex as those may have changed when 'subscribed' again
        mapper.reset()

        // if flag returnDisconnectsAsUndefined is set yield undefined
        if (returnDisconnectsAsUndefined) {
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

  private _validateInputs<T extends Exchange>(
    exchange: T,
    from: string,
    to: string,
    filters: FilterForExchange[T][] | undefined = undefined
  ) {
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
  filters?: FilterForExchange[T][]
  skipDecoding?: U
  returnDisconnectsAsUndefined?: Z
}

export type ReplayNormalizedOptions<Z extends boolean = false> = {
  from: string
  to: string
  exchange: Exchange
  symbols?: string[]
  returnDisconnectsAsUndefined?: Z
}
