import crypto, { createHash } from 'crypto'
import { createWriteStream, ensureDirSync, rename, removeSync } from 'fs-extra'
import https, { RequestOptions } from 'https'
import createHttpsProxyAgent from 'https-proxy-agent'
import got, { ExtendOptions } from 'got'
import path from 'path'
import { debug } from './debug'
import { Mapper } from './mappers'
import { Disconnect, Exchange, Filter, FilterForExchange } from './types'

export function parseAsUTCDate(val: string) {
  // not sure about this one, but it should force parsing date as UTC date not as local timezone
  if (val.endsWith('Z') === false) {
    val += 'Z'
  }
  var date = new Date(val)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()))
}

export function wait(delayMS: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMS)
  })
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
          localTimestamp: previousLocalTimestamp
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

export function parseμs(dateString: string): number {
  // check if we have ISO 8601 format date string, e.g: 2019-06-01T00:03:03.1238784Z or 2020-07-22T00:09:16.836773Z
  // or 2020-03-01T00:00:24.893456+00:00
  if (dateString.length === 27 || dateString.length === 28 || dateString.length === 32) {
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

export const httpsProxyAgent: https.Agent | undefined =
  process.env.HTTP_PROXY !== undefined ? createHttpsProxyAgent(process.env.HTTP_PROXY) : undefined

export async function download({
  apiKey,
  downloadPath,
  url,
  userAgent
}: {
  url: string
  downloadPath: string
  userAgent: string
  apiKey: string
}) {
  const httpRequestOptions = {
    agent: httpsProxyAgent !== undefined ? httpsProxyAgent : httpsAgent,
    timeout: 90 * ONE_SEC_IN_MS,
    headers: {
      'Accept-Encoding': 'gzip',
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
      return await _downloadFile(httpRequestOptions, url, downloadPath)
    } catch (error) {
      const badOrUnauthorizedRequest =
        error instanceof HttpError &&
        ((error.status === 400 && error.message.includes('ISO 8601 format') === false) || error.status === 401)
      const tooManyRequests = error instanceof HttpError && error.status === 429
      // do not retry when we've got bad or unauthorized request or enough attempts
      if (badOrUnauthorizedRequest || attempts === MAX_ATTEMPTS) {
        throw error
      }

      const randomIngridient = Math.random() * 500
      const attemptsDelayMS = Math.min(Math.pow(2, attempts) * ONE_SEC_IN_MS, 120 * ONE_SEC_IN_MS)
      let nextAttemptDelayMS = randomIngridient + attemptsDelayMS

      if (tooManyRequests) {
        // when too many requests received wait longer
        nextAttemptDelayMS += 3 * ONE_SEC_IN_MS * attempts
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

async function _downloadFile(requestOptions: RequestOptions, url: string, downloadPath: string) {
  // first ensure that directory where we want to download file exists
  ensureDirSync(path.dirname(downloadPath))

  // create write file stream that we'll write data into - first as unconfirmed temp file

  const tmpFilePath = `${downloadPath}${crypto.randomBytes(8).toString('hex')}.unconfirmed`
  const fileWriteStream = createWriteStream(tmpFilePath)
  const cleanup = () => {
    try {
      fileWriteStream.destroy()
      removeSync(tmpFilePath)
    } catch {}
  }
  tmpFileCleanups.set(tmpFilePath, cleanup)

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
          req.abort()
        })
    })

    // finally when saving from the network to file has succeded, rename tmp file to normal name
    // then we're sure that responses is 100% saved and also even if different process was doing the same we're good
    await rename(tmpFilePath, downloadPath)
  } finally {
    tmpFileCleanups.delete(tmpFilePath)
    cleanup()
  }
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
      this._set.delete(this._set.keys().next().value)
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

const gotDefaultOptions: ExtendOptions = {}

if (httpsProxyAgent !== undefined) {
  gotDefaultOptions.agent = {
    https: httpsProxyAgent
  }
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

export const httpClient = got.extend(gotDefaultOptions)
