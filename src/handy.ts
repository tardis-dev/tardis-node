import crypto, { createHash } from 'crypto'
import { createWriteStream, mkdirSync, rmSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import type { RequestOptions, Agent } from 'https'
import followRedirects from 'follow-redirects'
import * as httpsProxyAgentPkg from 'https-proxy-agent'
import path from 'path'
import { debug } from './debug.ts'
import { Mapper } from './mappers/index.ts'
import { Disconnect, Exchange, Filter, FilterForExchange } from './types.ts'
import * as socksProxyAgentPkg from 'socks-proxy-agent'
const { http, https } = followRedirects
const { HttpsProxyAgent } = httpsProxyAgentPkg
const { SocksProxyAgent } = socksProxyAgentPkg

export function parseAsUTCDate(val: string) {
  // Treat date-only and minute-level strings as UTC instead of local time.
  if (val.endsWith('Z') === false) {
    val += 'Z'
  }
  const date = new Date(val)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()))
}

export function wait(delayMS: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMS)
  })
}

export function getRandomString() {
  return crypto.randomBytes(24).toString('hex')
}

export function formatDateToPath(date: Date) {
  const year = date.getUTCFullYear()
  const month = doubleDigit(date.getUTCMonth() + 1)
  const day = doubleDigit(date.getUTCDate())
  const hour = doubleDigit(date.getUTCHours())
  const minute = doubleDigit(date.getUTCMinutes())

  return `${year}/${month}/${day}/${hour}/${minute}`
}

export function doubleDigit(input: number) {
  return input < 10 ? '0' + input : '' + input
}

export function sha256(obj: object) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000)
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 60000 * 1440)
}

export function* sequence(end: number, seed = 0) {
  let current = seed
  while (current < end) {
    yield current
    current += 1
  }

  return
}

export const ONE_SEC_IN_MS = 1000

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly responseText: string, public readonly url: string) {
    super(`HttpError: status code: ${status}, response text: ${responseText}`)
  }
}

class HttpClientError extends Error {
  constructor(public readonly response: HttpResponse, public readonly method: string, public readonly url: string) {
    super(`HTTP ${method} ${url} failed with status ${response.statusCode}`)
  }
}

export function* take(iterable: Iterable<any>, length: number) {
  if (length === 0) {
    return
  }
  for (const item of iterable) {
    yield item
    length--

    if (length === 0) {
      return
    }
  }
}

export async function* normalizeMessages(
  exchange: Exchange,
  symbols: string[] | undefined,
  messages: AsyncIterableIterator<{ localTimestamp: Date; message: any } | undefined>,
  mappers: Mapper<any, any>[],
  createMappers: (localTimestamp: Date) => Mapper<any, any>[],
  withDisconnectMessages: boolean | undefined,
  filter?: (symbol: string) => boolean,
  currentTimestamp?: Date | undefined
) {
  let previousLocalTimestamp: Date | undefined = currentTimestamp
  let mappersForExchange: Mapper<any, any>[] | undefined = mappers
  if (mappersForExchange.length === 0) {
    throw new Error(`Can't normalize data without any normalizers provided`)
  }

  for await (const messageWithTimestamp of messages) {
    if (messageWithTimestamp === undefined) {
      // we received undefined meaning Websocket disconnection
      // lets create new mappers with clean state for 'new connection'
      mappersForExchange = undefined

      // if flag withDisconnectMessages is set, yield disconnect message
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

    if (mappersForExchange === undefined) {
      mappersForExchange = createMappers(messageWithTimestamp.localTimestamp)
    }

    previousLocalTimestamp = messageWithTimestamp.localTimestamp

    for (const mapper of mappersForExchange) {
      if (mapper.canHandle(messageWithTimestamp.message)) {
        const mappedMessages = mapper.map(messageWithTimestamp.message, messageWithTimestamp.localTimestamp)
        if (!mappedMessages) {
          continue
        }

        for (const message of mappedMessages) {
          if (filter === undefined) {
            yield message
          } else if (filter(message.symbol)) {
            yield message
          }
        }
      }
    }
  }
}

export function getFilters<T extends Exchange>(mappers: Mapper<T, any>[], symbols?: string[]) {
  const filters = mappers.flatMap((mapper) => mapper.getFilters(symbols))

  const deduplicatedFilters = filters.reduce((prev, current) => {
    const matchingExisting = prev.find((c) => c.channel === current.channel)
    if (matchingExisting !== undefined) {
      if (matchingExisting.symbols !== undefined && current.symbols) {
        for (let symbol of current.symbols) {
          if (matchingExisting.symbols.includes(symbol) === false) {
            matchingExisting.symbols.push(symbol)
          }
        }
      } else if (current.symbols) {
        matchingExisting.symbols = [...current.symbols]
      }
    } else {
      prev.push(current)
    }

    return prev
  }, [] as FilterForExchange[T][])

  return deduplicatedFilters
}

export function* batch(symbols: string[], batchSize: number) {
  for (let i = 0; i < symbols.length; i += batchSize) {
    yield symbols.slice(i, i + batchSize)
  }
}
export function* batchObjects<T>(payload: T[], batchSize: number) {
  for (let i = 0; i < payload.length; i += batchSize) {
    yield payload.slice(i, i + batchSize)
  }
}

export function parseμs(dateString: string): number {
  // check if we have ISO 8601 format date string, e.g: 2019-06-01T00:03:03.1238784Z or 2020-07-22T00:09:16.836773Z
  // or 2020-03-01T00:00:24.893456+00:00
  if (dateString.length === 27 || dateString.length === 28 || dateString.length === 32 || dateString.length === 30) {
    return Number(dateString.slice(23, 26))
  }

  return 0
}

export function optimizeFilters(filters: Filter<any>[]) {
  // deduplicate filters (if the channel was provided multiple times)
  const optimizedFilters = filters.reduce((prev, current) => {
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
  optimizedFilters.sort((f1, f2) => {
    if (f1.channel < f2.channel) {
      return -1
    }

    if (f1.channel > f2.channel) {
      return 1
    }

    return 0
  })

  // sort and deduplicate filters symbols
  optimizedFilters.forEach((filter) => {
    if (filter.symbols) {
      filter.symbols = [...new Set(filter.symbols)].sort()
    }
  })

  return optimizedFilters
}

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10 * ONE_SEC_IN_MS,
  maxSockets: 120
})

export const httpsProxyAgent: Agent | undefined =
  process.env.HTTP_PROXY !== undefined
    ? new HttpsProxyAgent(process.env.HTTP_PROXY)
    : process.env.SOCKS_PROXY !== undefined
    ? new SocksProxyAgent(process.env.SOCKS_PROXY)
    : undefined

const DEFAULT_FETCH_RETRY_LIMIT = 2

type HttpRetryOptions =
  | number
  | {
      limit?: number
      statusCodes?: number[]
      maxRetryAfter?: number
    }

type HttpRequestOptions = {
  headers?: Record<string, string>
  body?: string | object
  timeout?: number
  retry?: HttpRetryOptions
}

type HttpResponse = {
  statusCode: number
  headers: Record<string, string>
  body: string
}

type JSONResponse<T> = {
  data: T
  headers: Record<string, string>
  statusCode: number
}

type RetrySettings = {
  limit: number
  maxRetryAfter?: number
  statusCodes?: Set<number>
}

function getRetrySettings(method: string, retry?: HttpRetryOptions): RetrySettings {
  const retryOptions = typeof retry === 'object' ? retry : undefined
  const retryEnabled = method === 'GET' || retry !== undefined
  const limit = typeof retry === 'number' ? retry : retryOptions?.limit ?? (retryEnabled ? DEFAULT_FETCH_RETRY_LIMIT : 0)

  return {
    limit,
    maxRetryAfter: retryOptions?.maxRetryAfter,
    statusCodes: retryOptions?.statusCodes ? new Set(retryOptions.statusCodes) : undefined
  }
}

function parseResponseHeaders(headers: Headers) {
  return Object.fromEntries(headers.entries())
}

function parseNodeResponseHeaders(headers: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) => {
      if (value === undefined) {
        return []
      }

      return [[key.toLowerCase(), Array.isArray(value) ? value.join(', ') : value]]
    })
  )
}

function createHttpResponse(statusCode: number, headers: Record<string, string>, body: string): HttpResponse {
  return {
    statusCode,
    headers,
    body
  }
}

function prepareRequest(method: string, options: HttpRequestOptions) {
  if (options.body === undefined) {
    return {
      headers: options.headers,
      body: undefined
    }
  }

  const headers = { ...options.headers }
  const body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)

  if (method !== 'GET' && headers['Content-Type'] === undefined && headers['content-type'] === undefined) {
    headers['Content-Type'] = 'application/json'
  }

  return {
    headers,
    body
  }
}

function getRetryAfterDelayMS(headers: Record<string, string>, maxRetryAfter?: number) {
  const retryAfterHeader = headers['retry-after']
  if (retryAfterHeader === undefined) {
    return
  }

  const parsedSeconds = Number.parseFloat(retryAfterHeader)
  let delayMS: number | undefined

  if (Number.isFinite(parsedSeconds)) {
    delayMS = parsedSeconds * ONE_SEC_IN_MS
  } else {
    const parsedDate = Date.parse(retryAfterHeader)
    if (Number.isFinite(parsedDate)) {
      delayMS = parsedDate - Date.now()
    }
  }

  if (delayMS === undefined || delayMS < 0) {
    return
  }

  if (maxRetryAfter !== undefined && delayMS > maxRetryAfter) {
    return
  }

  return delayMS
}

function getRetryDelayMS(attempt: number, headers: Record<string, string>, maxRetryAfter?: number) {
  const retryAfterDelayMS = getRetryAfterDelayMS(headers, maxRetryAfter)
  if (retryAfterDelayMS !== undefined) {
    return retryAfterDelayMS
  }

  return Math.min(250 * 2 ** (attempt - 1), 5000)
}

function isRetryableStatus(statusCode: number, retrySettings: RetrySettings) {
  if (retrySettings.statusCodes !== undefined) {
    return retrySettings.statusCodes.has(statusCode)
  }

  return statusCode === 408 || statusCode === 429 || statusCode >= 500
}

function shouldRetryHttpStatus(attempt: number, response: HttpResponse, retrySettings: RetrySettings) {
  return attempt <= retrySettings.limit && isRetryableStatus(response.statusCode, retrySettings)
}

function shouldRetryHttpError(attempt: number, retrySettings: RetrySettings) {
  return attempt <= retrySettings.limit
}

async function requestViaFetch(method: string, url: string, options: HttpRequestOptions): Promise<HttpResponse> {
  const controller = new AbortController()
  const timeoutMS = options.timeout
  const timeoutId = timeoutMS !== undefined ? setTimeout(() => controller.abort(), timeoutMS) : undefined
  const preparedRequest = prepareRequest(method, options)

  try {
    const response = await fetch(url, {
      method,
      headers: preparedRequest.headers,
      body: preparedRequest.body,
      signal: controller.signal
    })
    const body = await response.text()

    return createHttpResponse(response.status, parseResponseHeaders(response.headers), body)
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Request timed out')
    }

    throw error
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
}

async function requestViaProxy(method: string, url: string, options: HttpRequestOptions): Promise<HttpResponse> {
  const requestClient = new URL(url).protocol === 'http:' ? http : https
  const preparedRequest = prepareRequest(method, options)

  return await new Promise<HttpResponse>((resolve, reject) => {
    const request = requestClient
      .request(
        url,
        {
          method,
          agent: httpsProxyAgent,
          headers: preparedRequest.headers,
          timeout: options.timeout
        },
        (response) => {
          response.setEncoding('utf8')
          let body = ''
          response.on('error', reject)
          response.on('data', (chunk) => (body += chunk))
          response.on('end', () => {
            resolve(createHttpResponse(response.statusCode ?? 0, parseNodeResponseHeaders(response.headers), body))
          })
        }
      )
      .on('error', reject)
      .on('timeout', () => {
        reject(new Error('Request timed out'))
        request.destroy()
      })

    if (preparedRequest.body !== undefined) {
      request.write(preparedRequest.body)
    }

    request.end()
  })
}

async function request(method: string, url: string, options: HttpRequestOptions = {}) {
  const retrySettings = getRetrySettings(method, options.retry)

  for (let attempt = 1; ; attempt += 1) {
    try {
      const response =
        httpsProxyAgent === undefined ? await requestViaFetch(method, url, options) : await requestViaProxy(method, url, options)

      if (response.statusCode >= 200 && response.statusCode < 300) {
        return response
      }

      if (shouldRetryHttpStatus(attempt, response, retrySettings)) {
        await wait(getRetryDelayMS(attempt, response.headers, retrySettings.maxRetryAfter))
        continue
      }

      throw new HttpClientError(response, method, url)
    } catch (error) {
      if (error instanceof HttpClientError) {
        throw error
      }

      if (shouldRetryHttpError(attempt, retrySettings)) {
        await wait(Math.min(250 * 2 ** (attempt - 1), 5000))
        continue
      }

      throw error
    }
  }
}

async function requestJSON<T>(method: string, url: string, options?: HttpRequestOptions): Promise<JSONResponse<T>> {
  const response = await request(method, url, options)

  return {
    data: JSON.parse(response.body) as T,
    headers: response.headers,
    statusCode: response.statusCode
  }
}

export function getJSON<T>(url: string, options?: HttpRequestOptions) {
  return requestJSON<T>('GET', url, options)
}

export function postJSON<T>(url: string, options?: HttpRequestOptions) {
  return requestJSON<T>('POST', url, options)
}

export async function download({
  apiKey,
  downloadPath,
  url,
  userAgent,
  appendContentEncodingExtension = false,
  acceptEncoding = 'gzip'
}: {
  url: string
  downloadPath: string
  userAgent: string
  apiKey: string
  appendContentEncodingExtension?: boolean
  acceptEncoding?: string
}) {
  const httpRequestOptions = {
    agent: httpsProxyAgent !== undefined ? httpsProxyAgent : httpsAgent,
    timeout: 90 * ONE_SEC_IN_MS,
    headers: {
      'Accept-Encoding': acceptEncoding,
      'User-Agent': userAgent,
      Authorization: apiKey ? `Bearer ${apiKey}` : ''
    }
  }

  const MAX_ATTEMPTS = 30
  let attempts = 0

  while (true) {
    // simple retry logic when fetching from the network...
    attempts++
    try {
      const addRetryAttempt = attempts - 1 > 0 && url.endsWith('gz')
      if (addRetryAttempt) {
        return await _downloadFile(httpRequestOptions, `${url}?retryAttempt=${attempts - 1}`, downloadPath, appendContentEncodingExtension)
      } else {
        return await _downloadFile(httpRequestOptions, url, downloadPath, appendContentEncodingExtension)
      }
    } catch (error) {
      const unsupportedDataFeedEncoding = error instanceof Error && error.message.startsWith('Unsupported data feed content encoding')
      const badOrUnauthorizedRequest =
        error instanceof HttpError &&
        ((error.status === 400 && error.message.includes('ISO 8601 format') === false) || error.status === 401)
      const tooManyRequests = error instanceof HttpError && error.status === 429
      const internalServiceError = error instanceof HttpError && error.status === 500
      // do not retry when we've got bad or unauthorized request or enough attempts
      if (unsupportedDataFeedEncoding || badOrUnauthorizedRequest || attempts === MAX_ATTEMPTS) {
        throw error
      }

      const randomIngridient = Math.random() * 500
      const attemptsDelayMS = Math.min(Math.pow(2, attempts) * ONE_SEC_IN_MS, 120 * ONE_SEC_IN_MS)
      let nextAttemptDelayMS = randomIngridient + attemptsDelayMS

      if (tooManyRequests) {
        // when too many requests received wait one minute
        nextAttemptDelayMS += 60 * ONE_SEC_IN_MS
      }
      if (internalServiceError) {
        nextAttemptDelayMS = nextAttemptDelayMS * 2
      }

      debug('download file error: %o, next attempt delay: %d, url %s, path: %s', error, nextAttemptDelayMS, url, downloadPath)

      await wait(nextAttemptDelayMS)
    }
  }
}

const tmpFileCleanups = new Map<string, () => void>()

export function cleanTempFiles() {
  tmpFileCleanups.forEach((cleanup) => cleanup())
}

async function _downloadFile(requestOptions: RequestOptions, url: string, downloadPath: string, appendContentEncodingExtension: boolean) {
  // first ensure that directory where we want to download file exists
  mkdirSync(path.dirname(downloadPath), { recursive: true })

  // create write file stream that we'll write data into - first as unconfirmed temp file

  const tmpFilePath = `${downloadPath}${crypto.randomBytes(8).toString('hex')}.unconfirmed`
  const fileWriteStream = createWriteStream(tmpFilePath)
  const cleanup = () => {
    try {
      fileWriteStream.destroy()
      rmSync(tmpFilePath, { force: true })
    } catch {}
  }
  tmpFileCleanups.set(tmpFilePath, cleanup)

  let finalDownloadPath = downloadPath

  try {
    // based on https://github.com/nodejs/node/issues/28172 - only reliable way to consume response stream and avoiding all the 'gotchas'
    await new Promise<void>((resolve, reject) => {
      const req = https
        .get(url, requestOptions, (res) => {
          const { statusCode } = res
          if (statusCode !== 200) {
            // read the error response text and throw it as an HttpError
            res.setEncoding('utf8')
            let body = ''
            res.on('error', reject)
            res.on('data', (chunk) => (body += chunk))
            res.on('end', () => {
              reject(new HttpError(statusCode!, body, url))
            })
          } else {
            if (appendContentEncodingExtension) {
              const contentEncoding = asSingleHeaderValue(res.headers['content-encoding'])
              if (contentEncoding === 'zstd') {
                finalDownloadPath = `${downloadPath}.zst`
              } else if (contentEncoding === undefined || contentEncoding === 'gzip') {
                finalDownloadPath = `${downloadPath}.gz`
              } else {
                reject(new Error(`Unsupported data feed content encoding: ${contentEncoding}`))
                return
              }
            }

            // consume the response stream by writing it to the file
            res
              .on('error', reject)
              .on('aborted', () => reject(new Error('Request aborted')))
              .pipe(fileWriteStream)
              .on('error', reject)
              .on('finish', () => {
                if (res.complete) {
                  resolve()
                } else {
                  reject(new Error('The connection was terminated while the message was still being sent'))
                }
              })
          }
        })
        .on('error', reject)
        .on('timeout', () => {
          debug('download file request timeout, %s', url)
          reject(new Error('Request timed out'))
          req.destroy()
        })
    })

    // finally when saving from the network to file has succeded, rename tmp file to normal name
    // then we're sure that responses is 100% saved and also even if different process was doing the same we're good
    await rename(tmpFilePath, finalDownloadPath)

    return {
      downloadPath: finalDownloadPath
    }
  } finally {
    tmpFileCleanups.delete(tmpFilePath)
    cleanup()
  }
}

function asSingleHeaderValue(headerValue: string | string[] | undefined) {
  if (Array.isArray(headerValue)) {
    return headerValue[0]
  }

  return headerValue
}

export class CircularBuffer<T> {
  private _buffer: T[] = []
  private _index: number = 0
  constructor(private readonly _bufferSize: number) {}

  append(value: T) {
    const isFull = this._buffer.length === this._bufferSize
    let poppedValue
    if (isFull) {
      poppedValue = this._buffer[this._index]
    }
    this._buffer[this._index] = value
    this._index = (this._index + 1) % this._bufferSize

    return poppedValue
  }

  *items() {
    for (let i = 0; i < this._buffer.length; i++) {
      const index = (this._index + i) % this._buffer.length
      yield this._buffer[index]
    }
  }

  get count() {
    return this._buffer.length
  }

  clear() {
    this._buffer = []
    this._index = 0
  }
}

export class CappedSet<T> {
  private _set = new Set<T>()
  constructor(private readonly _maxSize: number) {}

  public has(value: T) {
    return this._set.has(value)
  }

  public add(value: T) {
    if (this._set.size >= this._maxSize) {
      this._set.delete(this._set.keys().next().value!)
    }
    this._set.add(value)
  }

  public remove(value: T) {
    this._set.delete(value)
  }

  public size() {
    return this._set.size
  }
}

function hasFraction(n: number) {
  return Math.abs(Math.round(n) - n) > 1e-10
}
// https://stackoverflow.com/a/44815797
export function decimalPlaces(n: number) {
  let count = 0
  // multiply by increasing powers of 10 until the fractional part is ~ 0
  while (hasFraction(n * 10 ** count) && isFinite(10 ** count)) count++
  return count
}

/**
 * Parses optional numeric fields where `undefined`, `null`, `NaN`, `Infinity`, and `-Infinity` are treated as not valid and mapped to `undefined`.
 * `0` is valid and preserved. Use for nullable/optional numeric fields such as open interest, funding rates, and greeks.
 */
export function asNumberOrUndefined(val: string | number | undefined | null) {
  if (val === undefined || val === null || val === '') {
    return
  }

  const asNumber = Number(val)
  return Number.isFinite(asNumber) ? asNumber : undefined
}

/**
 * Parses optional numeric fields where `0`, `undefined`, `null`, `NaN`, `Infinity`, and `-Infinity` are treated as not valid and mapped to `undefined`.
 * Use for empty quote/top-of-book values that exchanges encode as zero.
 */
export function asNumberIfValid(val: string | number | undefined | null) {
  if (val === undefined || val === null) {
    return
  }

  var asNumber = Number(val)

  if (isNaN(asNumber) || isFinite(asNumber) === false) {
    return
  }

  if (asNumber === 0) {
    return
  }

  return asNumber
}

export function upperCaseSymbols(symbols?: string[]) {
  if (symbols !== undefined) {
    return symbols.map((s) => s.toUpperCase())
  }
  return
}

export function lowerCaseSymbols(symbols?: string[]) {
  if (symbols !== undefined) {
    return symbols.map((s) => s.toLowerCase())
  }
  return
}

export const fromMicroSecondsToDate = (micros: number) => {
  const isMicroseconds = micros > 1e15 // Check if the number is likely in microseconds

  if (!isMicroseconds) {
    return new Date(micros)
  }

  const timestamp = new Date(micros / 1000)
  timestamp.μs = micros % 1000

  return timestamp
}

export function onlyUnique(value: string, index: number, array: string[]) {
  return array.indexOf(value) === index
}
