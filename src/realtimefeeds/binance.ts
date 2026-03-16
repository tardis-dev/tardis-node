import { Writable } from 'stream'
import { batch, httpClient, wait } from '../handy'
import { Filter } from '../types'
import { MultiConnectionRealTimeFeedBase, PoolingClientBase, RealTimeFeedBase } from './realtimefeed'

const binanceHttpOptions = {
  timeout: 10 * 1000,
  retry: {
    limit: 10,
    statusCodes: [418, 429, 500, 403],
    maxRetryAfter: 120 * 1000
  }
}

const DEFAULT_OPEN_INTEREST_MIN_AVAILABLE_WEIGHT_BUFFER = 100
const DEFAULT_OPEN_INTEREST_POLLING_INTERVAL_MS = 5 * 1000
const OPEN_INTEREST_BATCH_SIZE = 10
const OPEN_INTEREST_REQUEST_WEIGHT = 1
const OPEN_INTEREST_POLLING_RECOVERY_MS = 1000
const OPEN_INTEREST_MAX_POLLING_INTERVAL_MS = 60 * 1000

function parseBinanceWeightHeader(headerValue: string | string[] | undefined) {
  if (headerValue === undefined) {
    return undefined
  }

  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue
  const parsed = Number.parseInt(header, 10)

  return Number.isFinite(parsed) ? parsed : undefined
}

function getExchangeScopedNumberEnv(exchange: string, suffix: string, fallback: number) {
  const envName = `${exchange.toUpperCase().replace(/-/g, '_')}_${suffix}`
  const rawValue = process.env[envName]

  if (rawValue === undefined) {
    return fallback
  }

  const parsed = Number.parseInt(rawValue, 10)

  return Number.isFinite(parsed) ? parsed : fallback
}

function getBinanceRequestWeightLimit(exchange: string, exchangeInfo: any) {
  const configuredLimit = getExchangeScopedNumberEnv(exchange, 'REQUEST_WEIGHT_LIMIT', 0)
  if (configuredLimit > 0) {
    return configuredLimit
  }

  const requestWeightLimit = exchangeInfo.rateLimits.find((d: any) => d.rateLimitType === 'REQUEST_WEIGHT')?.limit as number | undefined

  if (!requestWeightLimit) {
    throw new Error('Failed to determine Binance REQUEST_WEIGHT limit')
  }

  return requestWeightLimit
}

function getBinanceAvailableWeight(weightLimit: number, usedWeight: number, buffer: number) {
  return weightLimit > 0 ? weightLimit - usedWeight - buffer : Infinity
}

function getDelayToNextMinuteMS() {
  const now = new Date()

  return Math.max((61 - now.getUTCSeconds()) * 1000 - now.getUTCMilliseconds(), 1)
}

abstract class BinanceRealTimeFeedBase extends MultiConnectionRealTimeFeedBase {
  protected abstract wssURL: string
  protected abstract httpURL: string
  protected abstract suffixes: { [key: string]: string }
  protected abstract depthRequestRequestWeight: number

  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const wsFilters = filters.filter(
      (f) =>
        f.channel !== 'openInterest' &&
        f.channel !== 'recentTrades' &&
        f.channel !== 'fundingInfo' &&
        f.channel !== 'insuranceBalance'
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
  private _requestWeightLimit: number
  private _usedWeight = 0

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
    this._requestWeightLimit = getExchangeScopedNumberEnv(_exchange, 'REQUEST_WEIGHT_LIMIT', 0)
    this._minAvailableWeightBuffer = getExchangeScopedNumberEnv(
      _exchange,
      'MIN_AVAILABLE_WEIGHT_BUFFER',
      DEFAULT_OPEN_INTEREST_MIN_AVAILABLE_WEIGHT_BUFFER
    )
  }

  protected getPoolingDelayMS() {
    return this._currentPollingIntervalMS
  }

  protected async poolDataToStream(outputStream: Writable) {
    let waitedForRateLimit = false

    if (!this._requestWeightLimit) {
      await this._initializeRateLimitInfo()
    }

    for (let index = 0; index < this._instruments.length; ) {
      if (outputStream.destroyed) {
        return
      }

      waitedForRateLimit = (await this._waitForAvailableWeight()) || waitedForRateLimit
      const batchSize = this._getBatchSize()

      if (batchSize <= 0) {
        break
      }

      const instrumentsBatch = this._instruments.slice(index, index + batchSize)
      index += instrumentsBatch.length

      const results = await Promise.allSettled(
        instrumentsBatch.map(async (instrument) => {
          const openInterestResponse = await httpClient.get(
            `${this._httpURL}/openInterest?symbol=${instrument.toUpperCase()}`,
            binanceHttpOptions
          )

          return {
            instrument,
            usedWeight: parseBinanceWeightHeader(openInterestResponse.headers['x-mbx-used-weight-1m'] as string | string[] | undefined),
            data: JSON.parse(openInterestResponse.body)
          }
        })
      )

      let maxUsedWeight: number | undefined
      let fulfilledCount = 0

      for (const result of results) {
        if (result.status === 'rejected') {
          this._notifyError(result.reason)
          continue
        }

        fulfilledCount++
        maxUsedWeight = Math.max(maxUsedWeight ?? 0, result.value.usedWeight ?? 0)

        if (outputStream.writable) {
          outputStream.write({
            stream: `${result.value.instrument.toLowerCase()}@openInterest`,
            generated: true,
            data: result.value.data
          })
        }
      }

      this._updateUsedWeight(maxUsedWeight || undefined, fulfilledCount * OPEN_INTEREST_REQUEST_WEIGHT)
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
    const available = getBinanceAvailableWeight(this._requestWeightLimit, this._usedWeight, this._minAvailableWeightBuffer)

    if (available >= OPEN_INTEREST_REQUEST_WEIGHT) {
      return false
    }

    const delayMS = getDelayToNextMinuteMS()
    this.debug(
      'open interest reached rate limit (limit: %s, used: %s, minimum available buffer: %s), waiting %s ms',
      this._requestWeightLimit,
      this._usedWeight,
      this._minAvailableWeightBuffer,
      delayMS
    )

    await wait(delayMS)

    // Binance request weight is tracked in a rolling 1-minute window. After waiting for the next minute
    // we can resume and let the next REST response header refresh the exact current usage.
    this._usedWeight = 0

    return true
  }

  private async _initializeRateLimitInfo() {
    const exchangeInfoResponse = await httpClient.get(`${this._httpURL}/exchangeInfo`, binanceHttpOptions)
    const exchangeInfo = JSON.parse(exchangeInfoResponse.body)

    this._requestWeightLimit = getBinanceRequestWeightLimit(this._exchange, exchangeInfo)

    this._updateUsedWeight(
      parseBinanceWeightHeader(exchangeInfoResponse.headers['x-mbx-used-weight-1m'] as string | string[] | undefined),
      OPEN_INTEREST_REQUEST_WEIGHT
    )
  }

  private _getBatchSize() {
    const available = getBinanceAvailableWeight(this._requestWeightLimit, this._usedWeight, this._minAvailableWeightBuffer)

    return Math.min(OPEN_INTEREST_BATCH_SIZE, Math.max(0, Math.floor(available)))
  }

  private _notifyError(error: unknown) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))

    this.debug('open interest request error %o', normalizedError)

    if (this.onError !== undefined) {
      this.onError(normalizedError)
    }
  }

  private _updateUsedWeight(usedWeight: number | undefined, fallbackIncrement = OPEN_INTEREST_REQUEST_WEIGHT) {
    if (usedWeight !== undefined) {
      this._usedWeight = usedWeight
      return
    }

    if (this._requestWeightLimit > 0 && fallbackIncrement > 0) {
      this._usedWeight += fallbackIncrement
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

    const exchangeInfoResponse = await httpClient.get(`${this._httpURL}/exchangeInfo`, binanceHttpOptions)
    const exchangeInfo = JSON.parse(exchangeInfoResponse.body)

    const DELAY_ENV = `${this._exchange.toUpperCase().replace(/-/g, '_')}_SNAPSHOTS_DELAY_MS`
    const currentWeightLimit = getBinanceRequestWeightLimit(this._exchange, exchangeInfo)

    let usedWeight = Number.parseInt(exchangeInfoResponse.headers['x-mbx-used-weight-1m'] as string)

    this.debug('current x-mbx-used-weight-1m limit: %s, already used weight: %s', currentWeightLimit, usedWeight)

    let concurrencyLimit = 4

    const CONCURRENCY_LIMIT_WEIGHT_ENV = `${this._exchange.toUpperCase().replace(/-/g, '_')}_CONCURRENCY_LIMIT`

    if (process.env[CONCURRENCY_LIMIT_WEIGHT_ENV] !== undefined) {
      concurrencyLimit = Number.parseInt(process.env[CONCURRENCY_LIMIT_WEIGHT_ENV] as string)
    }

    this.debug('current snapshots requests concurrency limit: %s', concurrencyLimit)

    const minWeightBuffer = getExchangeScopedNumberEnv(
      this._exchange,
      'MIN_AVAILABLE_WEIGHT_BUFFER',
      2 * concurrencyLimit * this._depthRequestRequestWeight
    )

    for (const symbolsBatch of batch(depthSnapshotFilter.symbols!, concurrencyLimit)) {
      if (shouldCancel()) {
        return
      }

      this.debug('requesting manual snapshots for: %s', symbolsBatch)

      const usedWeights = await Promise.all(
        symbolsBatch.map(async (symbol) => {
          if (shouldCancel()) {
            return 0
          }

          const isOverRateLimit = getBinanceAvailableWeight(currentWeightLimit, usedWeight, minWeightBuffer) < 0

          if (isOverRateLimit) {
            const delayMS = getDelayToNextMinuteMS()
            this.debug(
              'reached rate limit (x-mbx-used-weight-1m limit: %s, used weight: %s, minimum available weight buffer: %s), waiting: %s seconds',
              currentWeightLimit,
              usedWeight,
              minWeightBuffer,
              Math.ceil(delayMS / 1000)
            )

            await wait(delayMS)
          }

          const depthSnapshotResponse = await httpClient.get(
            `${this._httpURL}/depth?symbol=${symbol.toUpperCase()}&limit=1000`,
            binanceHttpOptions
          )

          const snapshot = {
            stream: `${symbol}@depthSnapshot`,
            generated: true,
            data: JSON.parse(depthSnapshotResponse.body)
          }

          this.manualSnapshotsBuffer.push(snapshot)

          if (process.env[DELAY_ENV] !== undefined) {
            const msToWait = Number.parseInt(process.env[DELAY_ENV] as string)

            await wait(msToWait)
          }

          return Number.parseInt(depthSnapshotResponse.headers['x-mbx-used-weight-1m'] as string)
        })
      )

      usedWeight = Math.max(...usedWeights)

      this.debug('requested manual snapshots successfully for: %s, used weight: %s', symbolsBatch, usedWeight)
    }
    this.debug('requested all manual snapshots successfully')
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
  protected wssURL = 'wss://fstream.binance.com/stream'
  protected httpURL = 'https://fapi.binance.com/fapi/v1'

  protected suffixes = {
    depth: '0ms',
    markPrice: '1s'
  }

  protected depthRequestRequestWeight = 20
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
