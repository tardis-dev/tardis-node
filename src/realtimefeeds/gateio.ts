import { httpClient } from '../handy'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class GateIORealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://api.gateio.ws/ws/v4/'
  protected httpURL = 'https://api.gateio.ws/api/v4'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const payload = filters.map((filter) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('GateIORealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      if (filter.channel === 'order_book_update') {
        return filter.symbols!.map((symbol) => {
          return {
            time: new Date().valueOf(),
            channel: `spot.${filter.channel}`,
            event: 'subscribe',
            method: `${filter.channel}.subscribe`,
            payload: [symbol, '100ms']
          }
        })
      } else {
        return filter.symbols!.map((symbol) => {
          return {
            time: new Date().valueOf(),
            channel: `spot.${filter.channel}`,
            event: 'subscribe',
            method: `${filter.channel}.subscribe`,
            payload: [symbol]
          }
        })
      }
    })

    return payload.flatMap((f) => f)
  }

  protected messageIsError(message: any): boolean {
    if (message.error !== null && message.error !== undefined) {
      return true
    }

    return false
  }

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const orderBookFilter = filters.find((f) => f.channel === 'order_book_update')
    if (!orderBookFilter) {
      return
    }

    this.debug('requesting manual snapshots for: %s', orderBookFilter.symbols!)

    for (let symbol of orderBookFilter.symbols!) {
      if (shouldCancel()) {
        return
      }

      const depthSnapshotResponse = await httpClient
        .get(`${this.httpURL}/spot/order_book?currency_pair=${symbol}&limit=100&with_id=true`)
        .json()

      const snapshot = {
        result: depthSnapshotResponse,
        event: 'snapshot',
        channel: `spot.order_book_update`,
        symbol,
        generated: true
      }

      this.manualSnapshotsBuffer.push(snapshot)
    }

    this.debug('requested manual snapshots successfully for: %s ', orderBookFilter.symbols!)
  }
}
