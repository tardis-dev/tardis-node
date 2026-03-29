import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { EventEmitter } from 'events'
import { Worker } from 'worker_threads'
import { constants, createGunzip, createZstdDecompress } from 'zlib'
import { BinarySplitStream } from './binarysplit.ts'
import { clearCacheSync } from './clearcache.ts'
import { EXCHANGES, EXCHANGE_CHANNELS_INFO } from './consts.ts'
import { debug } from './debug.ts'
import { addDays, getFilters, normalizeMessages, parseAsUTCDate, wait } from './handy.ts'
import { MapperFactory, normalizeBookChanges } from './mappers/index.ts'
import { getOptions } from './options.ts'
import { Disconnect, Exchange, FilterForExchange } from './types.ts'
import { WorkerJobPayload, WorkerMessage, WorkerSignal } from './worker.ts'

type MapperOutput<T> = T extends MapperFactory<any, infer U> ? U : never
type ReplayNormalizedMessage<U extends readonly MapperFactory<any, any>[], Z extends boolean> = Z extends true
  ? MapperOutput<U[number]> | Disconnect
  : MapperOutput<U[number]>

export async function* replay<T extends Exchange, U extends boolean = false, Z extends boolean = false>({
  exchange,
  from,
  to,
  filters,
  skipDecoding = undefined,
  withDisconnects = undefined,
  apiKey = undefined,
  withMicroseconds = undefined,
  autoCleanup = undefined,
  waitWhenDataNotYetAvailable = undefined
}: ReplayOptions<T, U, Z>): AsyncIterableIterator<
  Z extends true
    ? U extends true
      ? { localTimestamp: Buffer; message: Buffer } | undefined
      : { localTimestamp: Date; message: any } | undefined
    : U extends true
    ? { localTimestamp: Buffer; message: Buffer }
    : { localTimestamp: Date; message: any }
> {
  validateReplayOptions(exchange, from, to, filters)

  const fromDate = parseAsUTCDate(from)
  const toDate = parseAsUTCDate(to)
  const cachedSlicePaths = new Map<string, string>()
  let replayError
  debug('replay for exchange: %s started - from: %s, to: %s, filters: %o', exchange, fromDate.toISOString(), toDate.toISOString(), filters)

  const options = getOptions()

  // initialize worker thread that will fetch and cache data feed slices and "report back" by setting proper key/values in cachedSlicePaths
  const payload: WorkerJobPayload = {
    cacheDir: options.cacheDir,
    endpoint: options.endpoint,
    apiKey: apiKey || options.apiKey,
    userAgent: options._userAgent,
    fromDate,
    toDate,
    exchange,
    filters: filters || [],
    waitWhenDataNotYetAvailable
  }

  const worker = new ReliableWorker(payload)

  worker.on('message', (message: WorkerMessage) => {
    cachedSlicePaths.set(message.sliceKey, message.slicePath)
  })

  worker.on('error', (err) => {
    debug('worker error %o', err)

    replayError = err
  })

  try {
    // date is always formatted to have length of 28 so we can skip looking for first space in line and use it
    // as hardcoded value
    const DATE_MESSAGE_SPLIT_INDEX = 28

    // more lenient gzip decompression
    // see https://github.com/request/request/pull/2492 and https://github.com/node-fetch/node-fetch/pull/239

    const CHUNK_SIZE = 256 * 1024
    const GZIP_OPTIONS = {
      chunkSize: CHUNK_SIZE,
      flush: constants.Z_SYNC_FLUSH,
      finishFlush: constants.Z_SYNC_FLUSH
    }

    // helper flag that helps us not yielding two subsequent undefined/disconnect messages
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

        // if something went wrong(network issue, auth issue, gunzip issue etc)
        if (replayError !== undefined) {
          throw replayError
        }

        if (cachedSlicePath === undefined) {
          // if response for requested date is not ready yet wait 100ms and try again
          debug('waiting for slice: %s, exchange: %s', sliceKey, exchange)
          await wait(100)
        }
      }

      // response is a path to file on disk let' read it as stream
      const isZstdSlice = cachedSlicePath.endsWith('.zst')
      const linesStream = createReadStream(cachedSlicePath, { highWaterMark: CHUNK_SIZE })
        // decompress it while preserving the on-disk cache in the negotiated wire format
        .pipe(isZstdSlice ? createZstdDecompress({ chunkSize: CHUNK_SIZE }) : createGunzip(GZIP_OPTIONS))
        .on('error', function onDecompressionError(err) {
          debug('%s decompression error %o', isZstdSlice ? 'zstd' : 'gzip', err)
          linesStream.destroy(err)
        })
        // and split by new line
        .pipe(new BinarySplitStream())
        .on('error', function onBinarySplitStreamError(err) {
          debug('binary split stream error %o', err)
          linesStream.destroy(err)
        })

      let linesCount = 0

      for await (const bufferLine of linesStream as unknown as Iterable<Buffer>) {
        linesCount++
        if (bufferLine.length > 0) {
          lastMessageWasUndefined = false
          // as any due to https://github.com/Microsoft/TypeScript/issues/24929
          if (skipDecoding === true) {
            yield {
              localTimestamp: bufferLine.slice(0, DATE_MESSAGE_SPLIT_INDEX),
              message: bufferLine.slice(DATE_MESSAGE_SPLIT_INDEX + 1)
            } as any
          } else {
            let messageString = bufferLine.toString('utf8', DATE_MESSAGE_SPLIT_INDEX + 1)

            // hack to handle huobi long numeric id for trades
            if (exchange.startsWith('huobi-') && messageString.includes('.trade.detail')) {
              messageString = messageString.replace(/"id":([0-9]+),/g, '"id":"$1",')
            }
            // hack to handle upbit long numeric id for trades
            if (exchange === 'upbit' && messageString.includes('sequential_id')) {
              messageString = messageString.replace(/"sequential_id":([0-9]+),/g, '"sequential_id":"$1",')
            }

            const message = JSON.parse(messageString)

            const localTimestamp = new Date(bufferLine.toString('utf8', 0, DATE_MESSAGE_SPLIT_INDEX))
            if (withMicroseconds) {
              localTimestamp.μs = parseReplayMicroseconds(bufferLine)
            }

            yield {
              // when skipDecoding is not set, decode timestamp to Date and message to object
              localTimestamp,
              message
            } as any
          }
          // ignore empty lines unless withDisconnects is set to true
          // do not yield subsequent undefined messages
        } else if (withDisconnects === true && lastMessageWasUndefined === false) {
          lastMessageWasUndefined = true
          yield undefined as any
        }
      }

      debug('processed slice: %s, exchange: %s, count: %d', sliceKey, exchange, linesCount)

      // remove slice key from the map as it's already processed
      cachedSlicePaths.delete(sliceKey)

      if (autoCleanup) {
        await cleanupSlice(cachedSlicePath)
      }
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
  } finally {
    if (autoCleanup) {
      debug(
        'replay for exchange %s auto cleanup started - from: %s, to: %s, filters: %o',
        exchange,
        fromDate.toISOString(),
        toDate.toISOString(),
        filters
      )
      let startDate = new Date(fromDate)
      while (startDate < toDate) {
        clearCacheSync(exchange, filters, startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, startDate.getUTCDate())

        startDate = addDays(startDate, 1)
      }

      debug(
        'replay for exchange %s auto cleanup finished - from: %s, to: %s, filters: %o',
        exchange,
        fromDate.toISOString(),
        toDate.toISOString(),
        filters
      )
    }

    const underlyingWorker = worker.getUnderlyingWorker()
    if (underlyingWorker !== undefined) {
      await terminateWorker(underlyingWorker, 500)
    }
  }
}

async function cleanupSlice(slicePath: string) {
  try {
    await rm(slicePath, { force: true })
  } catch (e) {
    debug('cleanupSlice error %s %o', slicePath, e)
  }
}

function parseReplayMicroseconds(bufferLine: Buffer) {
  return (bufferLine[23] - 48) * 100 + (bufferLine[24] - 48) * 10 + (bufferLine[25] - 48)
}

// gracefully terminate worker
async function terminateWorker(worker: Worker, waitTimeout: number) {
  let cancelWait = () => {}
  const maxWaitGuard = new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, waitTimeout)
    cancelWait = () => clearTimeout(timeoutId)
  })

  const readyToTerminate = new Promise<void>((resolve) => {
    worker.once('message', (signal) => signal === WorkerSignal.READY_TO_TERMINATE && resolve())
  }).then(cancelWait)

  worker.postMessage(WorkerSignal.BEFORE_TERMINATE)
  await Promise.race([readyToTerminate, maxWaitGuard])
  await worker.terminate()
}

export function replayNormalized<T extends Exchange, U extends MapperFactory<T, any>[], Z extends boolean = false>(
  {
    exchange,
    symbols,
    from,
    to,
    withDisconnectMessages = undefined,
    apiKey = undefined,
    autoCleanup = undefined,
    waitWhenDataNotYetAvailable = undefined
  }: ReplayNormalizedOptions<T, Z>,
  ...normalizers: U
): AsyncIterableIterator<ReplayNormalizedMessage<U, Z>> {
  const fromDate = parseAsUTCDate(from)

  validateReplayNormalizedOptions(fromDate, normalizers)

  //TODO: zrovi replay dzien po dniu, tak ze kazdego dnia przekazuje swierze filters

  const createMappers = (localTimestamp: Date) => normalizers.map((m) => m(exchange, localTimestamp))
  const mappers = createMappers(fromDate)
  const filters = getFilters(mappers, symbols)

  const messages = replay({
    exchange,
    from,
    to,
    withDisconnects: true,
    filters,
    apiKey,
    withMicroseconds: true,
    autoCleanup,
    waitWhenDataNotYetAvailable
  })

  // filter normalized messages by symbol as some exchanges do not provide server side filtering so we could end up with messages
  // for symbols we've not requested for
  const upperCaseSymbols = symbols !== undefined ? symbols.map((s) => s.toUpperCase()) : undefined
  const filter = (symbol: string) => {
    return upperCaseSymbols === undefined || upperCaseSymbols.length === 0 || upperCaseSymbols.includes(symbol)
  }

  return normalizeMessages(exchange, undefined, messages, mappers, createMappers, withDisconnectMessages, filter)
}

function validateReplayOptions<T extends Exchange>(exchange: T, from: string, to: string, filters: FilterForExchange[T][]) {
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
          `Invalid "filters[].channel" argument: ${filter.channel}. Please provide one of the following channels: ${EXCHANGE_CHANNELS_INFO[
            exchange
          ].join(', ')}.`
        )
      }

      if (filter.symbols && Array.isArray(filter.symbols) === false) {
        throw new Error(`Invalid "filters[].symbols" argument: ${filter.symbols}. Please provide array of symbol strings`)
      }
    }
  }
}

function validateReplayNormalizedOptions(fromDate: Date, normalizers: MapperFactory<any, any>[]) {
  const hasBookChangeNormalizer = normalizers.some((n) => n === normalizeBookChanges)
  const dateDoesNotStartAtTheBeginningOfTheDay = fromDate.getUTCHours() !== 0 || fromDate.getUTCMinutes() !== 0

  if (hasBookChangeNormalizer && dateDoesNotStartAtTheBeginningOfTheDay) {
    debug('Initial order book snapshots are available only at 00:00 UTC')
  }
}

class ReliableWorker extends EventEmitter {
  private _errorsCount = 0
  private _worker: Worker | undefined = undefined

  constructor(private readonly _payload: WorkerJobPayload) {
    super()

    this._initWorker()
  }

  private _initWorker() {
    this._worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: this._payload
    })

    this._worker.on('message', (message: WorkerMessage) => {
      this.emit('message', message)
    })

    this._worker.on('error', this._handleError)

    this._worker.on('exit', (code) => {
      debug('worker finished with code: %d', code)
    })
  }

  private _handleError = async (err: Error) => {
    debug('underlying worker error %o', err)

    if (err.message.includes('HttpError') === false && this._errorsCount < 30) {
      this._errorsCount++
      const delayMS = Math.min(Math.pow(2, this._errorsCount) * 1000, 120 * 1000)
      debug('re-init worker after: %d ms', delayMS)
      await wait(delayMS)
      // it was most likely unhandled socket hang up error, let's retry first with new worker and don't emit error right away
      this._initWorker()
    } else {
      this.emit('error', err)
    }
  }

  public getUnderlyingWorker() {
    return this._worker
  }
}

export type ReplayOptions<T extends Exchange, U extends boolean = false, Z extends boolean = false> = {
  readonly exchange: T
  readonly from: string
  readonly to: string
  readonly filters: FilterForExchange[T][]
  readonly skipDecoding?: U
  readonly withDisconnects?: Z
  readonly apiKey?: string
  readonly withMicroseconds?: boolean
  readonly autoCleanup?: boolean
  readonly waitWhenDataNotYetAvailable?: boolean | number
}

export type ReplayNormalizedOptions<T extends Exchange, U extends boolean = false> = {
  readonly exchange: T
  readonly symbols?: string[]
  readonly from: string
  readonly to: string
  readonly withDisconnectMessages?: U
  readonly apiKey?: string
  readonly autoCleanup?: boolean
  readonly waitWhenDataNotYetAvailable?: boolean | number
}
