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

const debug = dbg('tardis-client')
const SPACE_BYTE = 32

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

  public replay<T extends Exchange>(options: ReplayOptions<T>) {
    return this._replayImpl(options, true)
  }

  public replayRaw<T extends Exchange>(options: ReplayOptions<T>) {
    return this._replayImpl(options, false)
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

  private async *_replayImpl<T extends Exchange, U extends boolean>(
    { exchange, from, to, filters = undefined }: ReplayOptions<T>,
    decodeLine: U
  ): AsyncIterableIterator<U extends true ? { localTimestamp: Date; message: object } : { localTimestamp: Buffer; message: Buffer }> {
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

      for await (const line of linesStream) {
        const bufferLine = line as Buffer
        // ignore empty lines
        if (bufferLine.length > 0) {
          linesCount++
          const splitIndex = bufferLine.indexOf(SPACE_BYTE)
          const localTimestampBuffer = bufferLine.slice(0, splitIndex)
          const messageBuffer = bufferLine.slice(splitIndex + 1)
          // as any due to https://github.com/Microsoft/TypeScript/issues/24929
          if (decodeLine == true) {
            yield {
              // when decode line is set to true decode timestamp to Date object and message to object
              localTimestamp: new Date(localTimestampBuffer.toString()),
              message: JSON.parse(messageBuffer.toString()) as object
            } as any
          } else {
            yield {
              localTimestamp: localTimestampBuffer,
              message: messageBuffer
            } as any
          }
        }
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
            `Invalid "filters[].channel" argument: ${exchange}. Please provide one of the following channels: ${EXCHANGE_CHANNELS_INFO[
              exchange
            ].join(', ')}.`
          )
        }

        if (filter.symbols && Array.isArray(filter.symbols) === false) {
          throw new Error(`Invalid "filters[].symbols" argument: ${exchange}. Please provide array of symbol strings`)
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

export type ReplayOptions<T extends Exchange> = {
  exchange: T
  from: string
  to: string
  filters?: FilterForExchange[T][]
}
