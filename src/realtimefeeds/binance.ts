import { Writable } from 'stream'
import { batch, httpClient, wait } from '../handy'
import { Filter } from '../types'
import { MultiConnectionRealTimeFeedBase, PoolingClientBase, RealTimeFeedBase } from './realtimefeed'

const binanceHttpOptions = {
  timeout: 10 * 1000,
  retry: {
    limit: 10,
    statusCodes: [408, 429, 500],
    maxRetryAfter: 120 * 1000
  }
}

abstract class BinanceRealTimeFeedBase extends MultiConnectionRealTimeFeedBase {
  protected abstract wssURL: string
  protected abstract httpURL: string
  protected abstract suffixes: { [key: string]: string }
  protected abstract depthRequestRequestWeight: number

  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const wsFilters = filters.filter((f) => f.channel !== 'openInterest' && f.channel !== 'recentTrades')

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

      yield new BinanceFuturesOpenInterestClient(exchange, this.httpURL, instruments)
    }
  }
}

class BinanceFuturesOpenInterestClient extends PoolingClientBase {
  constructor(exchange: string, private readonly _httpURL: string, private readonly _instruments: string[]) {
    super(exchange, 30)
  }

  protected async poolDataToStream(outputStream: Writable) {
    for (const instruments of batch(this._instruments, 10)) {
      await Promise.allSettled(
        instruments.map(async (instrument) => {
          if (outputStream.destroyed) {
            return
          }
          const openInterestResponse = (await httpClient
            .get(`${this._httpURL}/openInterest?symbol=${instrument.toUpperCase()}`, binanceHttpOptions)
            .json()) as any

          const openInterestMessage = {
            stream: `${instrument.toLocaleLowerCase()}@openInterest`,
            generated: true,
            data: openInterestResponse
          }

          if (outputStream.writable) {
            outputStream.write(openInterestMessage)
          }
        })
      )
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

    let currentWeightLimit: number = 0

    const exchangeInfoResponse = await httpClient.get(`${this._httpURL}/exchangeInfo`, binanceHttpOptions)

    const exchangeInfo = JSON.parse(exchangeInfoResponse.body)

    const REQUEST_WEIGHT_LIMIT_ENV = `${this._exchange.toUpperCase().replace(/-/g, '_')}_REQUEST_WEIGHT_LIMIT`

    if (process.env[REQUEST_WEIGHT_LIMIT_ENV] !== undefined) {
      currentWeightLimit = Number.parseInt(process.env[REQUEST_WEIGHT_LIMIT_ENV] as string)
    }

    if (!currentWeightLimit) {
      currentWeightLimit = exchangeInfo.rateLimits.find((d: any) => d.rateLimitType === 'REQUEST_WEIGHT').limit as number
    }

    let usedWeight = Number.parseInt(exchangeInfoResponse.headers['x-mbx-used-weight-1m'] as string)

    this.debug('current x-mbx-used-weight-1m limit: %s, already used weight: %s', currentWeightLimit, usedWeight)

    let concurrencyLimit = 4

    const CONCURRENCY_LIMIT_WEIGHT_ENV = `${this._exchange.toUpperCase().replace(/-/g, '_')}_CONCURRENCY_LIMIT`

    if (process.env[CONCURRENCY_LIMIT_WEIGHT_ENV] !== undefined) {
      concurrencyLimit = Number.parseInt(process.env[CONCURRENCY_LIMIT_WEIGHT_ENV] as string)
    }

    this.debug('current snapshots requests concurrency limit: %s', concurrencyLimit)

    let minWeightBuffer = 2 * concurrencyLimit * this._depthRequestRequestWeight

    const MIN_WEIGHT_BUFFER_ENV = `${this._exchange.toUpperCase().replace(/-/g, '_')}_MIN_AVAILABLE_WEIGHT_BUFFER`

    if (process.env[MIN_WEIGHT_BUFFER_ENV] !== undefined) {
      minWeightBuffer = Number.parseInt(process.env[MIN_WEIGHT_BUFFER_ENV] as string)
    }

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

          const isOverRateLimit = currentWeightLimit - usedWeight < minWeightBuffer

          if (isOverRateLimit) {
            const secondsToWait = 61 - new Date().getUTCSeconds()
            this.debug(
              'reached rate limit (x-mbx-used-weight-1m limit: %s, used weight: %s, minimum available weight buffer: %s), waiting: %s seconds',
              currentWeightLimit,
              usedWeight,
              minWeightBuffer,
              secondsToWait
            )

            await wait(secondsToWait * 1000)
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
  protected wssURL = 'wss://stream.binance.com:9443/stream'
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
