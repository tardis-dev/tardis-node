import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { EventEmitter, once } from 'events'
import { Worker } from 'worker_threads'
import { constants, createGunzip, createZstdDecompress } from 'zlib'
import { BinarySplitBatchStream } from './binarysplit.ts'
import { clearCacheSync } from './clearcache.ts'
import { EXCHANGES, EXCHANGE_CHANNELS_INFO } from './consts.ts'
import { debug } from './debug.ts'
import { addDays, createNormalizedSymbolFilter, getFilters, parseAsUTCDate, wait } from './handy.ts'
import { Mapper, MapperFactory, normalizeBookChanges } from './mappers/index.ts'
import { getOptions } from './options.ts'
import { Disconnect, Exchange, FilterForExchange } from './types.ts'
import { WorkerJobPayload, WorkerMessage, WorkerSignal } from './worker.ts'

type MapperOutput<T> = T extends MapperFactory<any, infer U> ? U : never
type ReplayNormalizedMessage<U extends readonly MapperFactory<any, any>[], Z extends boolean> = Z extends true
  ? MapperOutput<U[number]> | Disconnect
  : MapperOutput<U[number]>

const DATE_MESSAGE_SPLIT_INDEX = 28
const CHUNK_SIZE = 256 * 1024
// Keep decompression lenient for partial gzip responses.
// See https://github.com/request/request/pull/2492 and https://github.com/node-fetch/node-fetch/pull/239.
const GZIP_OPTIONS = {
  chunkSize: CHUNK_SIZE,
  flush: constants.Z_SYNC_FLUSH,
  finishFlush: constants.Z_SYNC_FLUSH
}

type ReplayMessage = { localTimestamp: Date; message: any } | { localTimestamp: Buffer; message: Buffer } | undefined

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
  let lastMessageWasUndefined = false

  const lineBatches = replayLineBatches({ exchange, from, to, filters, apiKey, autoCleanup, waitWhenDataNotYetAvailable })
  for await (const bufferLines of lineBatches) {
    // Decode one line batch in a tight loop, then preserve the public one-message-at-a-time iterator.
    const messages: ReplayMessage[] = []

    for (let i = 0; i < bufferLines.length; i++) {
      const bufferLine = bufferLines[i]
      if (bufferLine.length > 0) {
        lastMessageWasUndefined = false
        if (skipDecoding === true) {
          messages.push({
            localTimestamp: bufferLine.slice(0, DATE_MESSAGE_SPLIT_INDEX),
            message: bufferLine.slice(DATE_MESSAGE_SPLIT_INDEX + 1)
          })
        } else {
          const message = parseReplayMessage(exchange, bufferLine)
          const localTimestamp = parseReplayTimestamp(bufferLine)
          if (withMicroseconds) {
            localTimestamp.μs = parseReplayMicroseconds(bufferLine)
          }

          messages.push({ localTimestamp, message })
        }
      } else if (withDisconnects === true && lastMessageWasUndefined === false) {
        lastMessageWasUndefined = true
        messages.push(undefined)
      }
    }

    // Drain a batch already received from the stream; its iterator surfaces later stream errors on the next read.
    for (let i = 0; i < messages.length; i++) {
      yield messages[i] as any
    }
  }
}

type ReplayLineOptions<T extends Exchange> = Pick<
  ReplayOptions<T, boolean, boolean>,
  'exchange' | 'from' | 'to' | 'filters' | 'apiKey' | 'autoCleanup' | 'waitWhenDataNotYetAvailable'
>

async function* replayLineBatches<T extends Exchange>({
  exchange,
  from,
  to,
  filters,
  apiKey = undefined,
  autoCleanup = undefined,
  waitWhenDataNotYetAvailable = undefined
}: ReplayLineOptions<T>): AsyncIterableIterator<Buffer[]> {
  validateReplayOptions(exchange, from, to, filters)

  const fromDate = parseAsUTCDate(from)
  const toDate = parseAsUTCDate(to)
  const cachedSlicePaths = new Map<string, { slicePath: string; sliceSize: number }>()
  let replayError
  debug('replay for exchange: %s started - from: %s, to: %s, filters: %o', exchange, fromDate.toISOString(), toDate.toISOString(), filters)

  const options = getOptions()

  // initialize worker thread that will fetch and cache data feed slices and "report back" by setting proper key/values in cachedSlicePaths
  const payload: WorkerJobPayload = {
    cacheDir: options.cacheDir,
    endpoint: options.endpoint,
    apiKey: apiKey || options.apiKey,
    dataFeedCompression: options.dataFeedCompression,
    userAgent: options._userAgent,
    fromDate,
    toDate,
    exchange,
    filters: filters || [],
    waitWhenDataNotYetAvailable
  }

  const worker = new ReliableWorker(payload)

  worker.on('message', (message: WorkerMessage) => {
    cachedSlicePaths.set(message.sliceKey, {
      slicePath: message.slicePath,
      sliceSize: message.sliceSize
    })
  })

  worker.on('error', (err) => {
    debug('worker error %o', err)

    replayError = err
  })

  try {
    let currentSliceDate = new Date(fromDate)
    // iterate over every minute in <=from,to> date range
    // get cached slice paths, read them as file streams, decompress, split by new lines and yield as messages
    while (currentSliceDate < toDate) {
      const sliceKey = currentSliceDate.toISOString()

      debug('getting slice: %s, exchange: %s', sliceKey, exchange)

      let cachedSlice
      while (cachedSlice === undefined) {
        cachedSlice = cachedSlicePaths.get(sliceKey)

        // if something went wrong(network issue, auth issue, gunzip issue etc)
        if (replayError !== undefined) {
          throw replayError
        }

        if (cachedSlice === undefined) {
          // if the requested slice is not ready yet, wait for the worker to report another cached slice
          debug('waiting for slice: %s, exchange: %s', sliceKey, exchange)
          await once(worker, 'message')
        }
      }

      // response is a path to file on disk let' read it as stream
      const { slicePath: cachedSlicePath, sliceSize } = cachedSlice
      const isZstdSlice = cachedSlicePath.endsWith('.zst')
      const linesStream = createReadStream(cachedSlicePath, { highWaterMark: CHUNK_SIZE })
        // decompress it while preserving the on-disk cache in the negotiated wire format
        .pipe(isZstdSlice ? createZstdDecompress({ chunkSize: CHUNK_SIZE }) : createGunzip(GZIP_OPTIONS))
        .on('error', function onDecompressionError(err) {
          debug('%s decompression error %o', isZstdSlice ? 'zstd' : 'gzip', err)
          linesStream.destroy(err)
        })
        // and split by new line
        .pipe(new BinarySplitBatchStream())
        .on('error', function onBinarySplitStreamError(err) {
          debug('binary split stream error %o', err)
          linesStream.destroy(err)
        })

      let linesCount = 0

      for await (const bufferLines of linesStream as AsyncIterable<Buffer[]>) {
        linesCount += bufferLines.length
        yield bufferLines
      }

      debug('processed slice: %s, exchange: %s, count: %d', sliceKey, exchange, linesCount)

      // remove slice key from the map as it's already processed
      cachedSlicePaths.delete(sliceKey)

      if (autoCleanup) {
        await cleanupSlice(cachedSlicePath)
      }
      // move by the number of minutes covered by this cached response
      currentSliceDate.setUTCMinutes(currentSliceDate.getUTCMinutes() + sliceSize)
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

function parseReplayMessage(exchange: Exchange, bufferLine: Buffer) {
  let messageString = bufferLine.toString('utf8', DATE_MESSAGE_SPLIT_INDEX + 1)

  // hack to handle huobi long numeric id for trades
  if (exchange.startsWith('huobi-') && messageString.includes('.trade.detail')) {
    messageString = messageString.replace(/"id":([0-9]+),/g, '"id":"$1",')
  }
  // hack to handle upbit long numeric id for trades
  if (exchange === 'upbit' && messageString.includes('sequential_id')) {
    messageString = messageString.replace(/"sequential_id":([0-9]+),/g, '"sequential_id":"$1",')
  }

  return JSON.parse(messageString)
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

function parseReplayTimestamp(bufferLine: Buffer) {
  // Recorder writes yyyy-MM-ddTHH:mm:ss.fffffffZ.
  return new Date(
    Date.UTC(
      parseReplayDigits(bufferLine, 0, 4),
      parseReplayDigits(bufferLine, 5, 2) - 1,
      parseReplayDigits(bufferLine, 8, 2),
      parseReplayDigits(bufferLine, 11, 2),
      parseReplayDigits(bufferLine, 14, 2),
      parseReplayDigits(bufferLine, 17, 2),
      parseReplayDigits(bufferLine, 20, 3)
    )
  )
}

function parseReplayDigits(bufferLine: Buffer, start: number, length: number) {
  let value = 0
  const end = start + length
  for (let index = start; index < end; index++) {
    value = value * 10 + (bufferLine[index] - 48)
  }
  return value
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
  const toDate = parseAsUTCDate(to)

  validateReplayNormalizedOptions(fromDate, normalizers)

  const createMappersAt = (localTimestamp: Date) => normalizers.map((normalizer) => normalizer(exchange, localTimestamp))
  const initialMappers = createMappersAt(fromDate)
  const filters = getFilters(initialMappers, symbols)

  // filter normalized messages by symbol as some exchanges do not provide server side filtering so we could end up with messages
  // for symbols we've not requested for
  const segments = getReplayNormalizedSegments(exchange, normalizers, fromDate, toDate)

  if (segments.length <= 1) {
    const filter = createNormalizedSymbolFilter(symbols, filters)
    const lineBatches = replayLineBatches({
      exchange,
      from,
      to,
      filters,
      apiKey,
      autoCleanup,
      waitWhenDataNotYetAvailable
    })

    return normalizeReplayLineBatches(exchange, undefined, lineBatches, initialMappers, createMappersAt, withDisconnectMessages, filter)
  }

  return replayNormalizedSegments()

  async function* replayNormalizedSegments() {
    for (let i = 0; i < segments.length; i++) {
      const { from: segmentFrom, to: segmentTo } = segments[i]
      const segmentMappers = i === 0 ? initialMappers : createMappersAt(segmentFrom)
      const segmentFilters = getFilters(segmentMappers, symbols)
      const segmentFilter = createNormalizedSymbolFilter(symbols, segmentFilters)

      const segmentLineBatches = replayLineBatches({
        exchange,
        from: segmentFrom.toISOString(),
        to: segmentTo.toISOString(),
        filters: segmentFilters,
        apiKey,
        autoCleanup,
        waitWhenDataNotYetAvailable
      })

      yield* normalizeReplayLineBatches(
        exchange,
        undefined,
        segmentLineBatches,
        segmentMappers,
        createMappersAt,
        withDisconnectMessages,
        segmentFilter
      )
    }
  }
}

async function* normalizeReplayLineBatches(
  exchange: Exchange,
  symbols: string[] | undefined,
  lineBatches: AsyncIterableIterator<Buffer[]>,
  initialMappers: Mapper<any, any>[],
  createMappersAt: (localTimestamp: Date) => Mapper<any, any>[],
  withDisconnectMessages: boolean | undefined,
  filter?: (symbol: string) => boolean
) {
  // This intentionally keeps mapper calls lazy. Custom normalizers must not process later raw messages before the consumer asks for them.
  let previousLocalTimestamp: Date | undefined
  let activeMappers: Mapper<any, any>[] | undefined = initialMappers
  if (activeMappers.length === 0) {
    throw new Error(`Can't normalize data without any normalizers provided`)
  }

  for await (const bufferLines of lineBatches) {
    for (let i = 0; i < bufferLines.length; i++) {
      const bufferLine = bufferLines[i]
      if (bufferLine.length === 0) {
        if (activeMappers === undefined) {
          continue
        }

        activeMappers = undefined
        if (withDisconnectMessages === true && previousLocalTimestamp !== undefined) {
          const disconnect: Disconnect = {
            type: 'disconnect',
            exchange,
            localTimestamp: previousLocalTimestamp,
            symbols
          }
          yield disconnect as any
        }
        continue
      }

      const message = parseReplayMessage(exchange, bufferLine)
      const localTimestamp = parseReplayTimestamp(bufferLine)
      localTimestamp.μs = parseReplayMicroseconds(bufferLine)

      if (activeMappers === undefined) {
        activeMappers = createMappersAt(localTimestamp)
      }
      previousLocalTimestamp = localTimestamp

      for (let mapperIndex = 0; mapperIndex < activeMappers.length; mapperIndex++) {
        const mapper = activeMappers[mapperIndex]
        if (mapper.canHandle(message)) {
          const mappedMessages = mapper.map(message, localTimestamp)
          if (!mappedMessages) {
            continue
          }

          for (const normalizedMessage of mappedMessages) {
            if (filter === undefined || filter(normalizedMessage.symbol)) {
              yield normalizedMessage
            }
          }
        }
      }
    }
  }
}

function getReplayNormalizedSegments<T extends Exchange>(exchange: T, normalizers: MapperFactory<T, any>[], fromDate: Date, toDate: Date) {
  const fromTime = fromDate.valueOf()
  const toTime = toDate.valueOf()
  if (Number.isFinite(fromTime) === false || Number.isFinite(toTime) === false || fromTime >= toTime) {
    return [{ from: fromDate, to: toDate }]
  }

  const switchTimes = new Set<number>()
  for (const normalizer of normalizers) {
    const switchDates = normalizer.getSwitchDates?.(exchange) ?? []
    for (const switchDate of switchDates) {
      const switchTime = switchDate.valueOf()
      if (fromTime < switchTime && switchTime < toTime) {
        switchTimes.add(switchTime)
      }
    }
  }

  const switchDates = [...switchTimes].sort((a, b) => a - b).map((switchTime) => new Date(switchTime))
  const segments: { from: Date; to: Date }[] = []
  let segmentFrom = fromDate

  for (const switchDate of switchDates) {
    segments.push({ from: segmentFrom, to: switchDate })
    segmentFrom = switchDate
  }
  segments.push({ from: segmentFrom, to: toDate })

  return segments
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
