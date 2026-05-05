import dbg from 'debug'
import { existsSync } from 'node:fs'
import pMap from 'p-map'
import { isMainThread, parentPort, workerData } from 'worker_threads'
import { addMinutes, download, formatDateToPath, optimizeFilters, sequence, sha256, wait, cleanTempFiles } from './handy.ts'
import type { DataFeedCompression } from './options.ts'
import { Exchange, Filter } from './types.ts'
const debug = dbg('tardis-dev')

const DEFAULT_DATA_FEED_SLICE_SIZE = 1

if (isMainThread) {
  debug('current worker is not meant to run in main thread')
} else {
  parentPort!.on('message', (signal: WorkerSignal) => {
    if (signal === WorkerSignal.BEFORE_TERMINATE) {
      cleanTempFiles()
      parentPort!.postMessage(WorkerSignal.READY_TO_TERMINATE)
    }
  })
  getDataFeedSlices(workerData as WorkerJobPayload)
}

process.on('unhandledRejection', (err, promise) => {
  debug('Unhandled Rejection at: %o, reason: %o', promise, err)
  throw err
})

async function getDataFeedSlices(payload: WorkerJobPayload) {
  const MILLISECONDS_IN_MINUTE = 60 * 1000
  const CONCURRENCY_LIMIT = 60
  // deduplicate filters (if the channel was provided multiple times)
  const filters = optimizeFilters(payload.filters)

  // let's calculate number of minutes between "from" and "to" dates as those will give us total number of requests or checks
  // that will have to be performed concurrently with CONCURRENCY_LIMIT
  const minutesCountToFetch = Math.floor((payload.toDate.getTime() - payload.fromDate.getTime()) / MILLISECONDS_IN_MINUTE)

  // each filter will have separate sub dir based on it's sha hash
  const cacheDir = `${payload.cacheDir}/feeds/${payload.exchange}/${sha256(filters)}`

  const waitOffsetMS =
    typeof payload.waitWhenDataNotYetAvailable === 'number'
      ? payload.waitWhenDataNotYetAvailable * MILLISECONDS_IN_MINUTE
      : 30 * MILLISECONDS_IN_MINUTE

  if (payload.waitWhenDataNotYetAvailable && payload.toDate.valueOf() > new Date().valueOf() - waitOffsetMS) {
    let timestampForLastAvailableData = new Date().valueOf() - waitOffsetMS

    // in case when even initial from date is not yet available wait until it is
    if (timestampForLastAvailableData < payload.fromDate.valueOf()) {
      const initialWaitTime = payload.fromDate.valueOf() - timestampForLastAvailableData
      if (initialWaitTime > 0) {
        await wait(initialWaitTime)
      }
    }

    // fetch concurently any data that is already available
    timestampForLastAvailableData = new Date().valueOf() - waitOffsetMS
    const minutesCountThatAreAlreadyAvailableToFetch = Math.floor(
      (timestampForLastAvailableData - payload.fromDate.valueOf()) / MILLISECONDS_IN_MINUTE
    )

    await pMap(sequence(minutesCountThatAreAlreadyAvailableToFetch, 0), (offset) => getDataFeedSlice(payload, offset, filters, cacheDir), {
      concurrency: CONCURRENCY_LIMIT
    })

    // for remaining data iterate one by one and wait as needed
    for (let offset = minutesCountThatAreAlreadyAvailableToFetch; offset < minutesCountToFetch; offset++) {
      const timestampToFetch = payload.fromDate.valueOf() + offset * MILLISECONDS_IN_MINUTE
      timestampForLastAvailableData = new Date().valueOf() - waitOffsetMS

      if (timestampToFetch > timestampForLastAvailableData) {
        const waitTime = timestampToFetch - timestampForLastAvailableData + 100

        await wait(waitTime)
      }
      await getDataFeedSlice(payload, offset, filters, cacheDir)
    }
  } else {
    // fetch last slice - it will tell us if user has access to the end of requested date range and data is available
    // also fetch it from API to get current suggested slice size headers
    const lastSlice = await getDataFeedSlice(payload, minutesCountToFetch - 1, filters, cacheDir, DEFAULT_DATA_FEED_SLICE_SIZE, false)

    // fetch first slice - it will tell us if user has access to the beginning of requested date range
    const firstSlice =
      minutesCountToFetch === 1 ? lastSlice : await getDataFeedSlice(payload, 0, filters, cacheDir, DEFAULT_DATA_FEED_SLICE_SIZE, false)

    const replaySliceSize =
      filters.length === 0 ? DEFAULT_DATA_FEED_SLICE_SIZE : Math.max(firstSlice.suggestedSliceSize, lastSlice.suggestedSliceSize)
    const sliceOffsets: number[] = []
    for (let offset = 1; offset < minutesCountToFetch - 1; offset += replaySliceSize) {
      sliceOffsets.push(offset)
    }

    // it both begining and end date of the range is accessible fetch all remaning slices concurently with CONCURRENCY_LIMIT
    await pMap(
      sliceOffsets,
      async (offset) => {
        const requestedSliceSize = Math.min(replaySliceSize, minutesCountToFetch - 1 - offset)
        await getDataFeedSlice(payload, offset, filters, cacheDir, requestedSliceSize)
      },
      { concurrency: CONCURRENCY_LIMIT }
    )
  }
}

async function getDataFeedSlice(
  { exchange, fromDate, endpoint, apiKey, dataFeedCompression, userAgent }: WorkerJobPayload,
  offset: number,
  filters: object[],
  cacheDir: string,
  requestedSliceSize = DEFAULT_DATA_FEED_SLICE_SIZE,
  useCache = true
) {
  const sliceTimestamp = addMinutes(fromDate, offset)
  const sliceKey = sliceTimestamp.toISOString()
  const sliceSizeSuffix = requestedSliceSize === DEFAULT_DATA_FEED_SLICE_SIZE ? '' : `.size-${requestedSliceSize}`
  const sliceBasePath = `${cacheDir}/${formatDateToPath(sliceTimestamp)}${sliceSizeSuffix}.json`
  const zstdSlicePath = `${sliceBasePath}.zst`
  const gzipSlicePath = `${sliceBasePath}.gz`
  let cachedSlicePath
  if (useCache) {
    cachedSlicePath = existsSync(zstdSlicePath) ? zstdSlicePath : existsSync(gzipSlicePath) ? gzipSlicePath : undefined
  }

  if (cachedSlicePath !== undefined) {
    debug('getDataFeedSlice already cached: %s, sliceSize: %d', sliceKey, requestedSliceSize)
    const message: WorkerMessage = {
      sliceKey,
      slicePath: cachedSlicePath,
      sliceSize: requestedSliceSize
    }
    parentPort!.postMessage(message)
    return {
      sliceSize: requestedSliceSize,
      suggestedSliceSize: DEFAULT_DATA_FEED_SLICE_SIZE
    }
  }

  let url = `${endpoint}/data-feeds/${exchange}?from=${fromDate.toISOString()}&offset=${offset}&compression=${dataFeedCompression}`
  if (requestedSliceSize > DEFAULT_DATA_FEED_SLICE_SIZE) {
    url += `&sliceSize=${requestedSliceSize}`
  }

  if (filters.length > 0) {
    url += `&filters=${encodeURIComponent(JSON.stringify(filters))}`
  }

  const downloadResult = await download({
    apiKey,
    downloadPath: sliceBasePath,
    url,
    userAgent,
    appendContentEncodingExtension: true,
    acceptEncoding: dataFeedCompression === 'gzip' ? 'gzip' : 'zstd, gzip'
  })
  const responseSliceSize = Number(downloadResult.headers['x-slice-size'])
  const suggestedSliceSize = Number(downloadResult.headers['x-suggested-slice-size'] ?? DEFAULT_DATA_FEED_SLICE_SIZE)

  debug('getDataFeedSlice fetched from API and cached, %s, sliceSize: %d', sliceKey, responseSliceSize)
  const message: WorkerMessage = {
    sliceKey,
    slicePath: downloadResult.downloadPath,
    sliceSize: responseSliceSize
  }
  parentPort!.postMessage(message)

  return {
    sliceSize: responseSliceSize,
    suggestedSliceSize
  }
}

export type WorkerMessage = {
  sliceKey: string
  slicePath: string
  sliceSize: number
}

export type WorkerJobPayload = {
  cacheDir: string
  endpoint: string
  apiKey: string
  dataFeedCompression: DataFeedCompression
  userAgent: string
  fromDate: Date
  toDate: Date
  exchange: Exchange
  filters: Filter<any>[]
  waitWhenDataNotYetAvailable?: boolean | number
}

export const enum WorkerSignal {
  BEFORE_TERMINATE = 'BEFORE_TERMINATE',
  READY_TO_TERMINATE = 'READY_TO_TERMINATE'
}
