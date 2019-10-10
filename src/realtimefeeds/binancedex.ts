import got from 'got'
import dbg from 'debug'
const debug = dbg('tardis-client')

import { RealTimeFeedBase } from './realtimefeed'
import { Filter } from '../types'

export class BinanceDexRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://dex.binance.org/api/ws'
  protected httpURL = 'https://dex.binance.org/api/v1'

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    return filters
      .filter(f => f.channel !== 'depthSnapshot')
      .map(filter => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BinanceDexRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return {
          method: 'subscribe',
          topic: filter.channel,
          symbols: filter.symbols
        }
      })
  }

  protected messageIsError(message: any): boolean {
    if (message.stream === undefined) {
      return true
    }

    return false
  }

  protected provideManualSnapshots = async (filters: Filter<string>[], snapshotsBuffer: any[], shouldCancel: () => boolean) => {
    const depthSnapshotFilter = filters.find(f => f.channel === 'depthSnapshot')
    if (!depthSnapshotFilter) {
      return
    }

    for (let symbol of depthSnapshotFilter.symbols!) {
      if (shouldCancel()) {
        return
      }
      debug('requesting manual snapshot for: %s', symbol)

      const depthSnapshotResponse = await got.get(`${this.httpURL}/depth?symbol=${symbol}&limit=1000`).json()

      const snapshot = {
        stream: `depthSnapshot`,
        generated: true,
        data: {
          symbol,
          ...depthSnapshotResponse
        }
      }

      snapshotsBuffer.push(snapshot)
    }
  }
}
