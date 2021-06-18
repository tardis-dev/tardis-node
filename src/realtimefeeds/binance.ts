import { Writable } from 'stream'
import { batch, httpClient } from '../handy'
import { Filter } from '../types'
import { MultiConnectionRealTimeFeedBase, PoolingClientBase, RealTimeFeedBase } from './realtimefeed'

abstract class BinanceRealTimeFeedBase extends MultiConnectionRealTimeFeedBase {
  protected abstract wssURL: string
  protected abstract httpURL: string
  protected abstract suffixes: { [key: string]: string }

  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const wsFilters = filters.filter((f) => f.channel !== 'openInterest' && f.channel !== 'recentTrades')

    if (wsFilters.length > 0) {
      yield new BinanceSingleConnectionRealTimeFeed(
        exchange,
        wsFilters,
        this.wssURL,
        this.httpURL,
        this.suffixes,
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
      await Promise.all(
        instruments.map(async (instrument) => {
          if (outputStream.destroyed) {
            return
          }

          const openInterestResponse = (await httpClient
            .get(`${this._httpURL}/openInterest?symbol=${instrument.toUpperCase()}`, { timeout: 10000 })
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
    this.debug('requesting manual snapshots for: %s', depthSnapshotFilter.symbols)
    for (let symbol of depthSnapshotFilter.symbols!) {
      if (shouldCancel()) {
        return
      }

      const depthSnapshotResponse = (await httpClient
        .get(`${this._httpURL}/depth?symbol=${symbol.toUpperCase()}&limit=1000`, { timeout: 10000 })
        .json()) as any

      const snapshot = {
        stream: `${symbol}@depthSnapshot`,
        generated: true,
        data: depthSnapshotResponse
      }

      this.manualSnapshotsBuffer.push(snapshot)
    }

    this.debug('requested manual snapshots successfully for: %s ', depthSnapshotFilter.symbols)
  }
}

export class BinanceRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://stream.binance.com:9443/stream'
  protected httpURL = 'https://api.binance.com/api/v1'

  protected suffixes = {
    depth: '100ms'
  }
}

export class BinanceJerseyRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://stream.binance.je:9443/stream'
  protected httpURL = 'https://api.binance.je/api/v1'

  protected suffixes = {
    depth: '100ms'
  }
}

export class BinanceUSRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://stream.binance.us:9443/stream'
  protected httpURL = 'https://api.binance.us/api/v1'

  protected suffixes = {
    depth: '100ms'
  }
}

export class BinanceFuturesRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://fstream3.binance.com/stream'
  protected httpURL = 'https://fapi.binance.com/fapi/v1'

  protected suffixes = {
    depth: '0ms',
    markPrice: '1s'
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
}
