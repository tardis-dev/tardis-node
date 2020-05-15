import dbg from 'debug'
import { existsSync } from 'fs-extra'
import pMap from 'p-map'
import { isMainThread, parentPort, workerData } from 'worker_threads'
import { addMinutes, download, formatDateToPath, optimizeFilters, sequence, sha256 } from './handy'
import { Exchange, Filter } from './types'

const debug = dbg('tardis-dev')

if (isMainThread) {
  debug('existing, worker is not meant to run in main thread')
} else {
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

  // start with fetching last slice - it will tell quickly if user has access to the end of requested date range
  await getDataFeedSlice(payload, minutesCountToFetch - 1, filters, cacheDir)
  // then fetch first slice - it will tell quickly if user has access to the beginning of requested date range
  await getDataFeedSlice(payload, 0, filters, cacheDir)
  // it both begining and end date of the range is accessible fetch all remaning slices concurently with CONCURRENCY_LIMIT

  await pMap(
    sequence(minutesCountToFetch - 1, 1), // this will produce Iterable sequence from 1 to minutesCountToFetch - 1 - as we already fetched first and last slice so no need to fetch them again
    (offset) => getDataFeedSlice(payload, offset, filters, cacheDir),
    { concurrency: CONCURRENCY_LIMIT }
  )
}

async function getDataFeedSlice(
  { exchange, fromDate, endpoint, apiKey, userAgent }: WorkerJobPayload,
  offset: number,
  filters: object[],
  cacheDir: string
) {
  const sliceTimestamp = addMinutes(fromDate, offset)
  const sliceKey = sliceTimestamp.toISOString()
  const slicePath = `${cacheDir}/${formatDateToPath(sliceTimestamp)}.json.gz`
  const isCached = existsSync(slicePath)

  let url = `${endpoint}/data-feeds/${exchange}?from=${fromDate.toISOString()}&offset=${offset}`

  if (filters.length > 0) {
    url += `&filters=${encodeURIComponent(JSON.stringify(filters))}`
  }

  if (!isCached) {
    await download({
      apiKey,
      downloadPath: slicePath,
      url,
      userAgent
    })

    debug('getDataFeedSlice fetched from API and cached, %s', sliceKey)
  } else {
    debug('getDataFeedSlice already cached: %s', sliceKey)
  }
  // everything went well (already cached or successfull cached) let's communicate it to parent thread
  const message: WorkerMessage = {
    sliceKey,
    slicePath
  }
  parentPort!.postMessage(message)
}

export type WorkerMessage = {
  sliceKey: string
  slicePath: string
}

export type WorkerJobPayload = {
  cacheDir: string
  endpoint: string
  apiKey: string
  userAgent: string
  fromDate: Date
  toDate: Date
  exchange: Exchange
  filters: Filter<any>[]
}
