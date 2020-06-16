import got from 'got'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

abstract class BinanceRealTimeFeedBase extends RealTimeFeedBase {
  protected abstract wssURL: string
  protected abstract httpURL: string
  protected bookUpdateSpeed = '@100ms'
  protected batchSubscriptions = true

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const payload = filters
      .filter((f) => f.channel !== 'depthSnapshot')
      .map((filter, index) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BinanceRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }
        const channel = filter.channel === 'depth' ? `depth${this.bookUpdateSpeed}` : filter.channel

        if (this.batchSubscriptions) {
          return [
            {
              method: 'SUBSCRIBE',
              params: filter.symbols.map((symbol) => `${symbol}@${channel}`),
              id: index + 1
            }
          ]
        } else {
          return filter.symbols.map((s, sIndex) => {
            return {
              method: 'SUBSCRIBE',
              params: [`${s}@${channel}`],
              id: index + sIndex + 1
            }
          })
        }
      })

    return payload.flatMap((p) => p)
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

      const depthSnapshotResponse = (await got.get(`${this.httpURL}/depth?symbol=${symbol.toUpperCase()}&limit=1000`).json()) as any

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
}

export class BinanceJerseyRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://stream.binance.je:9443/stream'
  protected httpURL = 'https://api.binance.je/api/v1'
}

export class BinanceUSRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://stream.binance.us:9443/stream'
  protected httpURL = 'https://api.binance.us/api/v1'
}

export class BinanceFuturesRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://fstream.binance.com/stream'
  protected httpURL = 'https://fapi.binance.com/fapi/v1'
  protected bookUpdateSpeed = '@0ms'
}

export class BinanceDeliveryRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://dstream.binance.com/stream'
  protected httpURL = 'https://dapi.binance.com/dapi/v1'
  protected bookUpdateSpeed = '@0ms'
}
