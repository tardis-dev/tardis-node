import { Writable } from 'stream'
import { batch, getJSON, wait } from '../handy.ts'
import { Filter } from '../types.ts'
import { MultiConnectionRealTimeFeedBase, PoolingClientBase, RealTimeFeedBase } from './realtimefeed.ts'
import { getExchangeScopedNumberEnv, getRequestWeightLimit, parseRequestWeightHeader, RequestWeightLimiter } from './requestweight.ts'

const binanceHttpOptions = {
  timeout: 10 * 1000,
  retry: {
    limit: 10,
    statusCodes: [429, 500, 403],
    maxRetryAfter: 120 * 1000
  }
}

const DEFAULT_OPEN_INTEREST_MIN_AVAILABLE_WEIGHT_BUFFER = 100
const DEFAULT_OPEN_INTEREST_POLLING_INTERVAL_MS = 5 * 1000
const OPEN_INTEREST_BATCH_SIZE = 10
const OPEN_INTEREST_REQUEST_WEIGHT = 1
const OPEN_INTEREST_POLLING_RECOVERY_MS = 1000
const OPEN_INTEREST_MAX_POLLING_INTERVAL_MS = 60 * 1000
const BINANCE_FUTURES_PUBLIC_CHANNELS = new Set(['bookTicker', 'depth', 'depthSnapshot', 'trade'])
const BINANCE_FUTURES_DEFAULT_WS_BASE_URL = 'wss://fstream.binance.com'
const BINANCE_FUTURES_PUBLIC_STREAM_PATH = '/public/stream'
const BINANCE_FUTURES_MARKET_STREAM_PATH = '/market/stream'

type BinanceFuturesStreamPath = typeof BINANCE_FUTURES_PUBLIC_STREAM_PATH | typeof BINANCE_FUTURES_MARKET_STREAM_PATH

function getExchangeScopedWssUrlEnv(exchange: string) {
  const envName = `WSS_URL_${exchange.toUpperCase().replace(/-/g, '_')}`

  return process.env[envName]
}

function normalizeBinanceSplitWsBaseUrl(wssUrl: string) {
  return wssUrl
    .replace(/\/(public|market|private)\/stream$/u, '')
    .replace(/\/stream$/u, '')
    .replace(/\/(public|market|private)$/u, '')
}

function getBinanceFuturesWebSocketUrl(exchange: string, streamPath: BinanceFuturesStreamPath) {
  const configuredWssUrl = getExchangeScopedWssUrlEnv(exchange) ?? BINANCE_FUTURES_DEFAULT_WS_BASE_URL
  const normalizedBaseUrl = normalizeBinanceSplitWsBaseUrl(configuredWssUrl)

  return `${normalizedBaseUrl}${streamPath}`
}

abstract class BinanceRealTimeFeedBase extends MultiConnectionRealTimeFeedBase {
  protected abstract wssURL: string
  protected abstract httpURL: string
  protected abstract suffixes: { [key: string]: string }
  protected abstract depthRequestRequestWeight: number

  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const wsFilters = filters.filter(
      (f) => f.channel !== 'openInterest' && f.channel !== 'recentTrades' && f.channel !== 'fundingInfo' && f.channel !== 'insuranceBalance'
    )

    if (wsFilters.length > 0) {
      yield new BinanceSingleConnectionRealTimeFeed(
        exchange,
        wsFilters,
        this.wssURL,
        this.httpURL,
        this.suffixes,
        this.depthRequestRequestWeight,
        timeoutIntervalMS,
        onError
      )
    }

    const openInterestFilters = filters.filter((f) => f.channel === 'openInterest')
    if (openInterestFilters.length > 0) {
      const instruments = openInterestFilters.flatMap((s) => s.symbols!)

      yield new BinanceFuturesOpenInterestClient(exchange, this.httpURL, instruments, onError)
    }
  }
}

class BinanceFuturesOpenInterestClient extends PoolingClientBase {
  private readonly _minPollingIntervalMS: number
  private readonly _minAvailableWeightBuffer: number
  private readonly _maxPollingIntervalMS: number
  private _currentPollingIntervalMS: number
  private _requestWeightLimiter: RequestWeightLimiter | undefined

  constructor(
    private readonly _exchange: string,
    private readonly _httpURL: string,
    private readonly _instruments: string[],
    onError?: (error: Error) => void
  ) {
    const minPollingIntervalMS = Math.max(
      getExchangeScopedNumberEnv(_exchange, 'OPEN_INTEREST_POLLING_INTERVAL_MS', DEFAULT_OPEN_INTEREST_POLLING_INTERVAL_MS),
      1000
    )

    super(_exchange, minPollingIntervalMS / 1000, onError)

    this._minPollingIntervalMS = minPollingIntervalMS
    this._maxPollingIntervalMS = Math.max(this._minPollingIntervalMS, OPEN_INTEREST_MAX_POLLING_INTERVAL_MS)
    this._currentPollingIntervalMS = minPollingIntervalMS
    this._minAvailableWeightBuffer = Math.max(
      getExchangeScopedNumberEnv(_exchange, 'MIN_AVAILABLE_WEIGHT_BUFFER', DEFAULT_OPEN_INTEREST_MIN_AVAILABLE_WEIGHT_BUFFER),
      0
    )

    const configuredRequestWeightLimit = getExchangeScopedNumberEnv(_exchange, 'REQUEST_WEIGHT_LIMIT', 0)
    if (configuredRequestWeightLimit > 0) {
      this._requestWeightLimiter = new RequestWeightLimiter(configuredRequestWeightLimit, this._minAvailableWeightBuffer)
    }
  }

  protected getPoolingDelayMS() {
    return this._currentPollingIntervalMS
  }

  protected async poolDataToStream(outputStream: Writable) {
    let waitedForRateLimit = false

    if (this._requestWeightLimiter === undefined) {
      await this._initializeRateLimitInfo()
    }

    for (let index = 0; index < this._instruments.length;) {
      if (outputStream.destroyed) {
        return
      }

      if (await this._waitForAvailableWeight()) {
        waitedForRateLimit = true
      }
      if (outputStream.destroyed) {
        return
      }

      const batchSize = Math.min(OPEN_INTEREST_BATCH_SIZE, Math.floor(this._requestWeightLimiter!.availableWeight))
      const instrumentsBatch = this._instruments.slice(index, index + batchSize)
      index += instrumentsBatch.length

      const results = await Promise.allSettled(
        instrumentsBatch.map(async (instrument) => {
          const openInterestResponse = await getJSON<any>(
            `${this._httpURL}/openInterest?symbol=${instrument.toUpperCase()}`,
            binanceHttpOptions
          )

          return {
            instrument,
            usedWeight: parseRequestWeightHeader(openInterestResponse.headers['x-mbx-used-weight-1m']),
            data: openInterestResponse.data
          }
        })
      )

      let maxUsedWeight: number | undefined

      for (const result of results) {
        if (result.status === 'rejected') {
          this._notifyError(result.reason)
          continue
        }

        if (result.value.usedWeight !== undefined) {
          maxUsedWeight = Math.max(maxUsedWeight ?? 0, result.value.usedWeight)
        }

        if (outputStream.writable) {
          outputStream.write({
            stream: `${result.value.instrument.toLowerCase()}@openInterest`,
            generated: true,
            data: result.value.data
          })
        }
      }

      this._requestWeightLimiter!.updateUsedWeight(maxUsedWeight, instrumentsBatch.length * OPEN_INTEREST_REQUEST_WEIGHT)
    }

    if (waitedForRateLimit) {
      this._currentPollingIntervalMS = Math.min(this._currentPollingIntervalMS + this._minPollingIntervalMS, this._maxPollingIntervalMS)
    } else {
      this._currentPollingIntervalMS = Math.max(
        this._minPollingIntervalMS,
        this._currentPollingIntervalMS - OPEN_INTEREST_POLLING_RECOVERY_MS
      )
    }
  }

  private async _waitForAvailableWeight() {
    return this._requestWeightLimiter!.waitForAvailableWeight(OPEN_INTEREST_REQUEST_WEIGHT, (delayMS) => {
      this.debug(
        'open interest reached rate limit (limit: %s, used: %s, minimum available buffer: %s), waiting %s ms',
        this._requestWeightLimiter!.limit,
        this._requestWeightLimiter!.usedWeight,
        this._requestWeightLimiter!.minAvailableWeightBuffer,
        delayMS
      )
    })
  }

  private async _initializeRateLimitInfo() {
    const exchangeInfoResponse = await getJSON<any>(`${this._httpURL}/exchangeInfo`, binanceHttpOptions)
    const exchangeInfo = exchangeInfoResponse.data

    this._requestWeightLimiter = new RequestWeightLimiter(
      getRequestWeightLimit(this._exchange, exchangeInfo),
      this._minAvailableWeightBuffer,
      parseRequestWeightHeader(exchangeInfoResponse.headers['x-mbx-used-weight-1m'])
    )
  }

  private _notifyError(error: unknown) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))

    this.debug('open interest request error %o', normalizedError)

    if (this.onError !== undefined) {
      this.onError(normalizedError)
    }
  }
}

class BinanceSingleConnectionRealTimeFeed extends RealTimeFeedBase {
  constructor(
    exchange: string,
    filters: Filter<string>[],
    protected wssURL: string,
    private readonly _httpURL: string,
    private readonly _suffixes: { [key: string]: string },
    private readonly _depthRequestRequestWeight: number,
    timeoutIntervalMS: number | undefined,
    onError?: (error: Error) => void
  ) {
    super(exchange, filters, timeoutIntervalMS, onError)
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const payload = filters
      .filter((f) => f.channel !== 'depthSnapshot')
      .map((filter, index) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BinanceRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        const suffix = this._suffixes[filter.channel]
        const channel = suffix !== undefined ? `${filter.channel}@${suffix}` : filter.channel

        return {
          method: 'SUBSCRIBE',
          params: filter.symbols.map((symbol) => `${symbol}@${channel}`),
          id: index + 1
        }
      })

    return payload
  }

  protected messageIsError(message: any): boolean {
    // subscription confirmation message
    if (message.result === null) {
      return false
    }

    if (message.stream === undefined) {
      return true
    }

    if (message.error !== undefined) {
      return true
    }

    return false
  }

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const depthSnapshotFilter = filters.find((f) => f.channel === 'depthSnapshot')

    if (!depthSnapshotFilter) {
      return
    }

    const exchangeInfoResponse = await getJSON<any>(`${this._httpURL}/exchangeInfo`, binanceHttpOptions)
    if (shouldCancel()) {
      return
    }
    const exchangeInfo = exchangeInfoResponse.data

    const DELAY_ENV = `${this._exchange.toUpperCase().replace(/-/g, '_')}_SNAPSHOTS_DELAY_MS`
    const currentWeightLimit = getRequestWeightLimit(this._exchange, exchangeInfo)

    const usedWeight = parseRequestWeightHeader(exchangeInfoResponse.headers['x-mbx-used-weight-1m']) ?? 0

    this.debug('current x-mbx-used-weight-1m limit: %s, already used weight: %s', currentWeightLimit, usedWeight)

    const concurrencyLimit = Math.max(getExchangeScopedNumberEnv(this._exchange, 'CONCURRENCY_LIMIT', 4), 1)

    this.debug('current snapshots requests concurrency limit: %s', concurrencyLimit)

    const minWeightBuffer = Math.max(
      getExchangeScopedNumberEnv(this._exchange, 'MIN_AVAILABLE_WEIGHT_BUFFER', 2 * concurrencyLimit * this._depthRequestRequestWeight),
      0
    )
    const requestWeightLimiter = new RequestWeightLimiter(currentWeightLimit, minWeightBuffer, usedWeight)

    for (const symbolsBatch of batch(depthSnapshotFilter.symbols!, concurrencyLimit)) {
      if (shouldCancel()) {
        return
      }

      this.debug('requesting manual snapshots for: %s', symbolsBatch)

      await requestWeightLimiter.waitForAvailableWeight(symbolsBatch.length * this._depthRequestRequestWeight, (delayMS) => {
        this.debug(
          'reached rate limit (x-mbx-used-weight-1m limit: %s, used weight: %s, minimum available weight buffer: %s), waiting: %s seconds',
          currentWeightLimit,
          requestWeightLimiter.usedWeight,
          minWeightBuffer,
          Math.ceil(delayMS / 1000)
        )
      })

      const usedWeights = await Promise.all(
        symbolsBatch.map(async (symbol) => {
          if (shouldCancel()) {
            return 0
          }

          const depthSnapshotResponse = await getJSON<any>(
            `${this._httpURL}/depth?symbol=${symbol.toUpperCase()}&limit=1000`,
            binanceHttpOptions
          )
          if (shouldCancel()) {
            return 0
          }

          const snapshot = {
            stream: `${symbol}@depthSnapshot`,
            generated: true,
            data: depthSnapshotResponse.data
          }

          this.manualSnapshotsBuffer.push(snapshot)

          if (process.env[DELAY_ENV] !== undefined) {
            const msToWait = Number.parseInt(process.env[DELAY_ENV] as string)

            await wait(msToWait)
          }

          return parseRequestWeightHeader(depthSnapshotResponse.headers['x-mbx-used-weight-1m'])
        })
      )

      const maxUsedWeight = Math.max(...usedWeights.map((weight) => weight ?? 0))
      requestWeightLimiter.updateUsedWeight(maxUsedWeight || undefined, symbolsBatch.length * this._depthRequestRequestWeight)

      this.debug('requested manual snapshots successfully for: %s, used weight: %s', symbolsBatch, requestWeightLimiter.usedWeight)
    }
    this.debug('requested all manual snapshots successfully')
  }
}

class BinanceFuturesSingleConnectionRealTimeFeed extends BinanceSingleConnectionRealTimeFeed {
  constructor(
    exchange: string,
    filters: Filter<string>[],
    private readonly _streamPath: BinanceFuturesStreamPath,
    httpURL: string,
    suffixes: { [key: string]: string },
    depthRequestRequestWeight: number,
    timeoutIntervalMS: number | undefined,
    onError?: (error: Error) => void
  ) {
    super(
      exchange,
      filters,
      getBinanceFuturesWebSocketUrl(exchange, _streamPath),
      httpURL,
      suffixes,
      depthRequestRequestWeight,
      timeoutIntervalMS,
      onError
    )
  }

  protected async getWebSocketUrl() {
    return getBinanceFuturesWebSocketUrl(this._exchange, this._streamPath)
  }
}

export class BinanceRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://stream.binance.com/stream?timeUnit=microsecond'
  protected httpURL = 'https://api.binance.com/api/v1'

  protected suffixes = {
    depth: '100ms'
  }

  protected depthRequestRequestWeight = 10
}

export class BinanceJerseyRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://stream.binance.je:9443/stream'
  protected httpURL = 'https://api.binance.je/api/v1'

  protected suffixes = {
    depth: '100ms'
  }

  protected depthRequestRequestWeight = 10
}

export class BinanceUSRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://stream.binance.us:9443/stream'
  protected httpURL = 'https://api.binance.us/api/v1'

  protected suffixes = {
    depth: '100ms'
  }

  protected depthRequestRequestWeight = 10
}

export class BinanceFuturesRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = `${BINANCE_FUTURES_DEFAULT_WS_BASE_URL}${BINANCE_FUTURES_PUBLIC_STREAM_PATH}`
  protected httpURL = 'https://fapi.binance.com/fapi/v1'

  protected suffixes = {
    depth: '0ms',
    markPrice: '1s'
  }

  protected depthRequestRequestWeight = 20

  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const wsFilters = filters.filter(
      (f) => f.channel !== 'openInterest' && f.channel !== 'recentTrades' && f.channel !== 'fundingInfo' && f.channel !== 'insuranceBalance'
    )

    const publicWsFilters = wsFilters.filter((f) => BINANCE_FUTURES_PUBLIC_CHANNELS.has(f.channel))
    if (publicWsFilters.length > 0) {
      yield new BinanceFuturesSingleConnectionRealTimeFeed(
        exchange,
        publicWsFilters,
        BINANCE_FUTURES_PUBLIC_STREAM_PATH,
        this.httpURL,
        this.suffixes,
        this.depthRequestRequestWeight,
        timeoutIntervalMS,
        onError
      )
    }

    const marketWsFilters = wsFilters.filter((f) => BINANCE_FUTURES_PUBLIC_CHANNELS.has(f.channel) === false)
    if (marketWsFilters.length > 0) {
      yield new BinanceFuturesSingleConnectionRealTimeFeed(
        exchange,
        marketWsFilters,
        BINANCE_FUTURES_MARKET_STREAM_PATH,
        this.httpURL,
        this.suffixes,
        this.depthRequestRequestWeight,
        timeoutIntervalMS,
        onError
      )
    }

    const openInterestFilters = filters.filter((f) => f.channel === 'openInterest')
    if (openInterestFilters.length > 0) {
      const instruments = openInterestFilters.flatMap((s) => s.symbols!)

      yield new BinanceFuturesOpenInterestClient(exchange, this.httpURL, instruments, onError)
    }
  }
}

export class BinanceDeliveryRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://dstream.binance.com/stream'
  protected httpURL = 'https://dapi.binance.com/dapi/v1'

  protected suffixes = {
    depth: '0ms',
    markPrice: '1s',
    indexPrice: '1s'
  }

  protected depthRequestRequestWeight = 20
}
