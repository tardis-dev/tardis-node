import { Writable } from 'stream'
import { batch, getJSON, wait } from '../handy.ts'
import { Filter } from '../types.ts'
import { MultiConnectionRealTimeFeedBase, PoolingClientBase, RealTimeFeedBase } from './realtimefeed.ts'
import { getExchangeScopedNumberEnv, getRequestWeightLimit, parseRequestWeightHeader, RequestWeightLimiter } from './requestweight.ts'

const asterHttpOptions = {
  timeout: 10 * 1000,
  retry: {
    limit: 10,
    statusCodes: [429, 500, 403],
    maxRetryAfter: 120 * 1000
  }
}

const DEFAULT_OPEN_INTEREST_MIN_AVAILABLE_WEIGHT_BUFFER = 100
const DEFAULT_OPEN_INTEREST_POLLING_INTERVAL_MS = 30 * 1000
const OPEN_INTEREST_BATCH_SIZE = 10
const OPEN_INTEREST_REQUEST_WEIGHT = 1
const OPEN_INTEREST_POLLING_RECOVERY_MS = 1000
const OPEN_INTEREST_MAX_POLLING_INTERVAL_MS = 60 * 1000

export class AsterRealTimeFeed extends RealTimeFeedBase {
  protected static readonly depthChannel = 'depth'
  protected static readonly depthSnapshotChannel = 'depthSnapshot'
  protected readonly depthStream: string = 'depth@0ms'
  protected readonly depthRequestRequestWeight = 20
  protected readonly wssURL: string = 'wss://sstream.asterdex.com/stream'
  protected readonly httpURL: string = 'https://sapi.asterdex.com/api/v3'
  protected readonly channels = new Set([
    'trade',
    'aggTrade',
    'ticker',
    AsterRealTimeFeed.depthChannel,
    AsterRealTimeFeed.depthSnapshotChannel,
    'bookTicker'
  ])
  protected readonly channelMappings: { [key: string]: string | undefined } = {
    [AsterRealTimeFeed.depthChannel]: this.depthStream
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const filtersWithSymbols = filters.map<Required<Filter<string>>>((filter) => {
      if (!this.channels.has(filter.channel)) {
        throw new Error(`AsterRealTimeFeed unsupported channel ${filter.channel}`)
      }

      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('AsterRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return filter as Required<Filter<string>>
    })

    const depthSnapshotFilters = filtersWithSymbols.filter((filter) => filter.channel === AsterRealTimeFeed.depthSnapshotChannel)
    this.validateDepthSnapshotFilters(filtersWithSymbols, depthSnapshotFilters)

    return filtersWithSymbols
      .filter((f) => f.channel !== AsterRealTimeFeed.depthSnapshotChannel)
      .map((filter, index) => {
        return {
          method: 'SUBSCRIBE',
          params: filter.symbols.map((symbol) => `${symbol.toLowerCase()}@${this.channelMappings[filter.channel] ?? filter.channel}`),
          id: index + 1
        }
      })
  }

  protected messageIsError(message: any): boolean {
    if (message.result === null) {
      return false
    }

    if (message.stream !== undefined) {
      return false
    }

    if (message.code !== undefined || message.error !== undefined) {
      return true
    }

    return false
  }

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const depthSnapshotFilter = filters.find((f) => f.channel === AsterRealTimeFeed.depthSnapshotChannel)
    if (!depthSnapshotFilter) {
      return
    }

    const exchangeInfoResponse = await getJSON<any>(`${this.httpURL}/exchangeInfo`, asterHttpOptions)
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
      getExchangeScopedNumberEnv(this._exchange, 'MIN_AVAILABLE_WEIGHT_BUFFER', 2 * concurrencyLimit * this.depthRequestRequestWeight),
      0
    )
    const requestWeightLimiter = new RequestWeightLimiter(currentWeightLimit, minWeightBuffer, usedWeight)

    for (const symbolsBatch of batch(depthSnapshotFilter.symbols!, concurrencyLimit)) {
      if (shouldCancel()) {
        return
      }

      this.debug('requesting manual snapshots for: %s', symbolsBatch)

      await requestWeightLimiter.waitForAvailableWeight(symbolsBatch.length * this.depthRequestRequestWeight, (delayMS) => {
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
            `${this.httpURL}/depth?symbol=${symbol.toUpperCase()}&limit=1000`,
            asterHttpOptions
          )
          if (shouldCancel()) {
            return 0
          }

          const snapshot = {
            stream: `${symbol.toLowerCase()}@${AsterRealTimeFeed.depthSnapshotChannel}`,
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
      requestWeightLimiter.updateUsedWeight(maxUsedWeight || undefined, symbolsBatch.length * this.depthRequestRequestWeight)

      this.debug('requested manual snapshots successfully for: %s, used weight: %s', symbolsBatch, requestWeightLimiter.usedWeight)
    }

    this.debug('requested all manual snapshots successfully')
  }

  private validateDepthSnapshotFilters(filters: Required<Filter<string>>[], depthSnapshotFilters: Required<Filter<string>>[]) {
    if (depthSnapshotFilters.length === 0) {
      return
    }

    const depthSymbols = new Set(
      filters
        .filter((filter) => filter.channel === AsterRealTimeFeed.depthChannel)
        .flatMap((filter) => filter.symbols.map((symbol) => symbol.toUpperCase()))
    )

    for (const filter of depthSnapshotFilters) {
      for (const symbol of filter.symbols) {
        if (depthSymbols.has(symbol.toUpperCase()) === false) {
          throw new Error(
            `AsterRealTimeFeed requires ${AsterRealTimeFeed.depthChannel} for every ${AsterRealTimeFeed.depthSnapshotChannel} symbol`
          )
        }
      }
    }
  }
}

export class AsterFuturesRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const webSocketFilters = filters.filter((filter) => filter.channel !== 'openInterest')
    if (webSocketFilters.length > 0) {
      yield new AsterFuturesWebSocketRealTimeFeed(exchange, webSocketFilters, timeoutIntervalMS, onError)
    }

    const openInterestFilters = filters.filter((filter) => filter.channel === 'openInterest')
    if (openInterestFilters.length > 0) {
      for (const filter of openInterestFilters) {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('AsterFuturesRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }
      }

      yield new AsterFuturesOpenInterestClient(
        exchange,
        'https://fapi.asterdex.com/fapi/v3',
        openInterestFilters.flatMap((filter) => filter.symbols!),
        onError
      )
    }
  }
}

export class AsterFuturesWebSocketRealTimeFeed extends AsterRealTimeFeed {
  protected readonly wssURL: string = 'wss://fstream.asterdex.com/stream'
  protected readonly httpURL: string = 'https://fapi.asterdex.com/fapi/v3'
  protected readonly channels = new Set([
    'trade',
    'aggTrade',
    'ticker',
    AsterRealTimeFeed.depthChannel,
    AsterRealTimeFeed.depthSnapshotChannel,
    'markPrice',
    'forceOrder',
    'bookTicker',
    'assetIndex'
  ])
  protected readonly channelMappings: { [key: string]: string | undefined } = {
    [AsterRealTimeFeed.depthChannel]: this.depthStream,
    markPrice: 'markPrice@1s'
  }
}

class AsterFuturesOpenInterestClient extends PoolingClientBase {
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
          const openInterestResponse = await getJSON<AsterFuturesOpenInterestData>(
            `${this._httpURL}/openInterest?symbol=${instrument.toUpperCase()}`,
            asterHttpOptions
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
    const exchangeInfoResponse = await getJSON<any>(`${this._httpURL}/exchangeInfo`, asterHttpOptions)
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

export type AsterFuturesOpenInterestData = {
  symbol: string
  openInterest: string
  time: number
}
