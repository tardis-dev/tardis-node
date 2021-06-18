import { httpClient } from '../handy'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class BinanceDexRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://dex.binance.org/api/ws'
  protected httpURL = 'https://dex.binance.org/api/v1'

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    return filters
      .filter((f) => f.channel !== 'depthSnapshot')
      .map((filter) => {
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

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const depthSnapshotFilter = filters.find((f) => f.channel === 'depthSnapshot')
    if (!depthSnapshotFilter) {
      return
    }
    this.debug('requesting manual snapshots for: %s', depthSnapshotFilter.symbols!)

    for (let symbol of depthSnapshotFilter.symbols!) {
      if (shouldCancel()) {
        return
      }

      const depthSnapshotResponse = (await httpClient.get(`${this.httpURL}/depth?symbol=${symbol}&limit=1000`).json()) as any

      const snapshot = {
        stream: `depthSnapshot`,
        generated: true,
        data: {
          symbol,
          ...depthSnapshotResponse
        }
      }

      this.manualSnapshotsBuffer.push(snapshot)
    }

    this.debug('requested manual snapshots successfully for: %s ', depthSnapshotFilter.symbols!)
  }
}
