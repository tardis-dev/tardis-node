import got from 'got'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

abstract class BinanceRealTimeFeedBase extends RealTimeFeedBase {
  protected abstract wssURL: string
  protected abstract httpURL: string
  protected bookUpdateSpeed = '@100ms'

  protected mapToSubscribeMessages(filters: Filter<string>[]): string | any[] {
    const payload = filters
      .filter(f => f.channel !== 'depthSnapshot')
      .map(filter => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BinanceRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map(s => {
          const channel = filter.channel === 'depth' ? `depth${this.bookUpdateSpeed}` : filter.channel

          return `${s}@${channel}`
        })
      })
      .flatMap(s => s)
      .join('/')

    return `/stream?streams=${payload}`
  }

  protected messageIsError(message: any): boolean {
    if (message.stream === undefined) {
      return true
    }
    return false
  }

  protected async provideManualSnapshots(filters: Filter<string>[], snapshotsBuffer: any[], shouldCancel: () => boolean) {
    const depthSnapshotFilter = filters.find(f => f.channel === 'depthSnapshot')
    if (!depthSnapshotFilter) {
      return
    }
    this.debug('requesting manual snapshots for: %s', depthSnapshotFilter.symbols)
    for (let symbol of depthSnapshotFilter.symbols!) {
      if (shouldCancel()) {
        return
      }

      let depthSnapshotResponse = (await got.get(`${this.httpURL}/depth?symbol=${symbol.toUpperCase()}&limit=1000`).json()) as any
      const snapshotIsStale = new Date(depthSnapshotResponse.T).getUTCSeconds() !== new Date(depthSnapshotResponse.E).getUTCSeconds()
      if (snapshotIsStale) {
        depthSnapshotResponse = (await got.get(`${this.httpURL}/depth?symbol=${symbol.toUpperCase()}&limit=1000`).json()) as any
      }

      const snapshot = {
        stream: `${symbol}@depthSnapshot`,
        generated: true,
        data: depthSnapshotResponse
      }

      snapshotsBuffer.push(snapshot)
    }

    this.debug('requested manual snapshots successfully for: %s ', depthSnapshotFilter.symbols)
  }
}

export class BinanceRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://stream.binance.com:9443'
  protected httpURL = 'https://api.binance.com/api/v1'
}

export class BinanceJerseyRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://stream.binance.je:9443'
  protected httpURL = 'https://api.binance.je/api/v1'
}

export class BinanceUSRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://stream.binance.us:9443'
  protected httpURL = 'https://api.binance.us/api/v1'
}

export class BinanceFuturesRealTimeFeed extends BinanceRealTimeFeedBase {
  protected wssURL = 'wss://fstream.binance.com'
  protected httpURL = 'https://fapi.binance.com/fapi/v1'
}
