import { httpClient } from '../handy'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class BitstampRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://ws.bitstamp.net'
  protected httpURL = 'https://www.bitstamp.net/api/v2'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BitstampRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          return {
            event: 'bts:subscribe',
            data: {
              channel: `${filter.channel}_${symbol}`
            }
          }
        })
      })
      .flatMap((c) => c)
  }

  protected messageIsError(message: any): boolean {
    if (message.channel === undefined) {
      return true
    }

    if (message.event === 'bts:request_reconnect') {
      return true
    }

    return false
  }

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const orderBookFilter = filters.find((f) => f.channel === 'diff_order_book')
    if (!orderBookFilter) {
      return
    }

    this.debug('requesting manual snapshots for: %s', orderBookFilter.symbols!)

    for (let symbol of orderBookFilter.symbols!) {
      if (shouldCancel()) {
        return
      }

      const depthSnapshotResponse = await httpClient.get(`${this.httpURL}/order_book/${symbol}?group=1`).json()

      const snapshot = {
        data: depthSnapshotResponse,
        event: 'snapshot',
        channel: `diff_order_book_${symbol}`,
        generated: true
      }

      this.manualSnapshotsBuffer.push(snapshot)
    }

    this.debug('requested manual snapshots successfully for: %s ', orderBookFilter.symbols!)
  }
}
