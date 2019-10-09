import got from 'got'
import dbg from 'debug'
const debug = dbg('tardis-client')

import { RealTimeFeedBase } from './realtimefeed'
import { Filter } from '../types'

export class BinanceRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://stream.binance.com:9443'
  protected httpURL = 'https://api.binance.com/api/v1'
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

    for (let symbol of depthSnapshotFilter.symbols!) {
      if (shouldCancel()) {
        return
      }

      debug('requesting manual snapshot for: %s', symbol)

      const depthSnapshotResponse = await got.get(`${this.httpURL}/depth?symbol=${symbol.toUpperCase()}&limit=1000`).json()

      const snapshot = {
        stream: `${symbol}@depthSnapshot`,
        generated: true,
        data: depthSnapshotResponse
      }

      snapshotsBuffer.push(snapshot)
    }
  }
}

export class BinanceJerseyRealTimeFeed extends BinanceRealTimeFeed {
  protected wssURL = 'wss://stream.binance.je:9443'
  protected httpURL = 'https://api.binance.je/api/v1'
}

export class BinanceUSRealTimeFeed extends BinanceRealTimeFeed {
  protected wssURL = 'wss://stream.binance.us:9443'
  protected httpURL = 'https://api.binance.us/api/v1'
}

export class BinanceFuturesRealTimeFeed extends BinanceRealTimeFeed {
  protected wssURL = 'wss://fstream.binance.com'
  protected httpURL = 'https://fapi.binance.com/fapi/v1'
  protected bookUpdateSpeed = ''
}
