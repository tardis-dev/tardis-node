import crypto from 'crypto'
import dbg from 'debug'
import { createWriteStream, ensureDirSync, existsSync, rename } from 'fs-extra'
import https, { RequestOptions } from 'https'
import pMap from 'p-map'
import path from 'path'
import { isMainThread, parentPort, workerData } from 'worker_threads'
import { addMinutes, formatDateToPath, HttpError, ONE_SEC_IN_MS, sequence, sha256, wait } from './handy'
import { Exchange, Filter } from './types'

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10 * ONE_SEC_IN_MS
})

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
  const filters = payload.filters.reduce((prev, current) => {
    const matchingExisting = prev.find((c) => c.channel === current.channel)

    if (matchingExisting) {
      // both previous and current have symbols let's merge them
      if (matchingExisting.symbols && current.symbols) {
        matchingExisting.symbols.push(...current.symbols)
      } else if (current.symbols) {
        matchingExisting.symbols = [...current.symbols]
      }
    } else {
      prev.push(current)
    }

    return prev
  }, [] as Filter<any>[])

  // sort filters in place to improve local disk cache ratio (no matter filters order if the same filters are provided will hit the cache)
  filters.sort((f1, f2) => {
    if (f1.channel < f2.channel) {
      return -1
    }

    if (f1.channel > f2.channel) {
      return 1
    }

    return 0
  })

  // sort and deduplicate filters symbols
  filters.forEach((filter) => {
    if (filter.symbols) {
      filter.symbols = [...new Set(filter.symbols)].sort()
    }
  })

  // let's calculate number of minutes between "from" and "to" dates as those will give us total number of requests or checks
  // that will have to be performed concurrently with CONCURRENCY_LIMIT
  const minutesCountToFetch = Math.floor((payload.toDate.getTime() - payload.fromDate.getTime()) / MILLISECONDS_IN_MINUTE)

  // each filter will have separate sub dir based on it's sha hash
  const cacheDir = `${payload.cacheDir}/feeds/${payload.exchange}/${sha256(filters)}/`

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

async function getDataFeedSlice(payload: WorkerJobPayload, offset: number, filters: object[], cacheDir: string) {
  const sliceTimestamp = addMinutes(payload.fromDate, offset)
  const sliceKey = sliceTimestamp.toISOString()
  const slicePath = `${cacheDir}/${formatDateToPath(sliceTimestamp)}.json.gz`
  const isCached = existsSync(slicePath)

  if (!isCached) {
    await reliablyFetchAndCacheSlice(payload, offset, filters, slicePath)
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

async function reliablyFetchAndCacheSlice(
  { exchange, fromDate, endpoint, apiKey, userAgent }: WorkerJobPayload,
  offset: number,
  filters: object[],
  sliceCachePath: string
) {
  let url = `${endpoint}/data-feeds/${exchange}?from=${fromDate.toISOString()}&offset=${offset}`

  if (filters.length > 0) {
    url += `&filters=${encodeURIComponent(JSON.stringify(filters))}`
  }

  const httpRequestOptions = {
    agent: httpsAgent,
    timeout: 45 * ONE_SEC_IN_MS,
    headers: {
      'Accept-Encoding': 'gzip',
      'User-Agent': userAgent,
      Authorization: apiKey ? `Bearer ${apiKey}` : ''
    }
  }

  const MAX_ATTEMPTS = 7
  let attempts = 0

  while (true) {
    // simple retry logic when fetching from the network...
    attempts++
    try {
      return await fetchAndCacheSlice(url, httpRequestOptions, sliceCachePath)
    } catch (error) {
      const badOrUnauthorizedRequest = error instanceof HttpError && (error.status === 400 || error.status === 401)
      const tooManyRequests = error instanceof HttpError && error.status === 429
      // do not retry when we've got bad or unauthorized request or enough attempts
      if (badOrUnauthorizedRequest || attempts === MAX_ATTEMPTS) {
        throw error
      }

      const randomIngridient = Math.random() * 500
      const attemptsDelayMS = Math.pow(2, attempts) * ONE_SEC_IN_MS
      let nextAttemptDelayMS = randomIngridient + attemptsDelayMS

      if (tooManyRequests) {
        // when too many requests received wait longer
        nextAttemptDelayMS += 3 * ONE_SEC_IN_MS * attempts
      }

      debug('fetchAndCacheSlice error: %o, next attempt delay: %d, path: %s', error, nextAttemptDelayMS, sliceCachePath)

      await wait(nextAttemptDelayMS)
    }
  }
}

async function fetchAndCacheSlice(url: string, options: RequestOptions, sliceCachePath: string) {
  // first ensure that directory where we want to cache slice exists
  ensureDirSync(path.dirname(sliceCachePath))

  // create write file stream that we'll save slice data into - first as unconfirmed temp file
  const tmpFilePath = `${sliceCachePath}${crypto.randomBytes(8).toString('hex')}.unconfirmed`
  const fileWriteStream = createWriteStream(tmpFilePath)
  try {
    // based on https://github.com/nodejs/node/issues/28172 - only reliable way to consume response stream and avoiding all the 'gotchas'
    await new Promise((resolve, reject) => {
      const req = https
        .get(url, options, (res) => {
          const { statusCode } = res
          if (statusCode !== 200) {
            // read the error response text and throw it as an HttpError
            res.setEncoding('utf8')
            let body = ''
            res.on('data', (chunk) => (body += chunk))
            res.on('end', () => {
              reject(new HttpError(statusCode!, body, url))
            })
          } else {
            // consume the response stream by writing it to the file
            res
              .on('error', reject)
              .on('aborted', () => reject(new Error('Request aborted')))
              .pipe(fileWriteStream)
              .on('error', reject)
              .on('finish', resolve)
          }
        })
        .on('error', reject)
        .on('timeout', () => {
          debug('fetchAndCacheSlice request timeout')
          req.abort()
        })
    })
  } finally {
    fileWriteStream.destroy()
  }

  // lastly when saving from the network to file succeded rename tmp file to normal name
  // so we're sure that responses is 100% saved and also even if different process was doing the same we're good
  await rename(tmpFilePath, sliceCachePath)
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
