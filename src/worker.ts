import crypto from 'crypto'
import https from 'https'
import path from 'path'
import { parentPort, isMainThread, workerData } from 'worker_threads'
import dbg from 'debug'
import pMap from 'p-map'
import { existsSync, ensureDirSync, createWriteStream, rename } from 'fs-extra'
import fetch, { RequestInit } from 'node-fetch'

import { Exchange, Filter } from './consts'
import { wait, sha256, formatDateToPath, addMinutes, ONE_SEC_IN_MS, HttpError, sequence } from './handy'

const debug = dbg('tardis-client')

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
  const fetchInit = {
    headers: {
      'Accept-Encoding': 'gzip',
      Authorization: payload.apiKey ? `Bearer ${payload.apiKey}` : ''
    },

    timeout: 20 * ONE_SEC_IN_MS,

    agent: new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 10 * ONE_SEC_IN_MS
    }),
    // do not auto decompress responses!
    compress: false
  }

  // deduplicate filters (if the channel was provided multiple times)
  const filters = payload.filters.reduce(
    (prev, current) => {
      const matchingExisting = prev.find(c => c.channel == current.channel)

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
    },
    [] as Filter<any>[]
  )

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
  filters.forEach(filter => {
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
  await getDataFeedSlice(payload.exchange, payload.fromDate, minutesCountToFetch - 1, filters, cacheDir, fetchInit, payload.endpoint)
  // then fetch first slice - it will tell quickly if user has access to the beginning of requested date range
  await getDataFeedSlice(payload.exchange, payload.fromDate, 0, filters, cacheDir, fetchInit, payload.endpoint)
  // it both begining and end date of the range is accessible fetch all remaning slices concurently with CONCURRENCY_LIMIT

  await pMap(
    sequence(minutesCountToFetch - 1, 1), // this will produce Iterable sequence from 1 to minutesCountToFetch - 1 - as we already fetched first and last slice so no need to fetch them again
    offset => getDataFeedSlice(payload.exchange, payload.fromDate, offset, filters, cacheDir, fetchInit, payload.endpoint),
    { concurrency: CONCURRENCY_LIMIT }
  )
}

async function getDataFeedSlice(
  exchange: Exchange,
  fromDate: Date,
  offset: number,
  filters: object[],
  cacheDir: string,
  fetchInit: RequestInit,
  endpoint: string
) {
  const sliceTimestamp = addMinutes(fromDate, offset)
  const sliceKey = sliceTimestamp.toISOString()
  const slicePath = `${cacheDir}/${formatDateToPath(sliceTimestamp)}.json.gz`
  const isCached = existsSync(slicePath)

  if (!isCached) {
    await fetchAndCacheSlice(exchange, fromDate, offset, filters, slicePath, fetchInit, endpoint)
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

async function fetchAndCacheSlice(
  exchange: Exchange,
  fromDate: Date,
  offset: number,
  filters: object[],
  sliceCachePath: string,
  fetchInit: RequestInit,
  endpoint: string
) {
  const MAX_ATTEMPTS = 4
  let attempts = 0
  let url = `${endpoint}/v1/data-feeds/${exchange}?from=${fromDate.toISOString()}&offset=${offset}`

  if (filters) {
    url += `&filters=${encodeURIComponent(JSON.stringify(filters))}`
  }

  while (true) {
    // simple retry logic when fetching from network...
    attempts++
    try {
      const response = await fetch(url, fetchInit)
      if (response.status === 200) {
        // if response is ok let's cache it and be done with it
        await cacheResponse(response.body, sliceCachePath)
        return
      } else {
        let errorText = ''
        try {
          errorText = await response.text()
        } catch {}
        throw new HttpError(response.status, errorText, url)
      }
    } catch (error) {
      const badOrUnauthorizedRequest = error instanceof HttpError && (error.status === 400 || error.status === 401)
      const tooManyRequests = error instanceof HttpError && error.status === 429
      // do not retry when we've got bad or unauthorized request or enough attempts
      if (badOrUnauthorizedRequest || attempts == MAX_ATTEMPTS) {
        throw error
      }

      const randomIngridient = Math.random() * 300
      const attemptsDelayMS = Math.pow(2, attempts) * 300
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

async function cacheResponse(responseStream: NodeJS.ReadableStream, sliceCachePath: string) {
  ensureDirSync(path.dirname(sliceCachePath))
  const tmpFilePath = `${sliceCachePath}${crypto.randomBytes(8).toString('hex')}.unconfirmed`
  // first write response stream to temp file
  const fileWriteableStream = createWriteStream(tmpFilePath)

  const writingTask = new Promise(function(resolve, reject) {
    responseStream.on('end', () => {
      fileWriteableStream.end(resolve)
    })

    responseStream.on('error', reject)
  })

  responseStream.pipe(fileWriteableStream)
  await writingTask

  // when it succeded rename tmp file to normal name
  // so we're sure that responses is 100% saved and also even it different process was doing the same we're good
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
  fromDate: Date
  toDate: Date
  exchange: Exchange
  filters: Filter<any>[]
}
