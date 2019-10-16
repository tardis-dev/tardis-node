import got from 'got'
import { RealTimeFeedBase } from './realtimefeed'
import { Filter } from '../types'

export class BitstampRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://ws.bitstamp.net'
  protected httpURL = 'https://www.bitstamp.net/api/v2'

  protected mapToSubscribeMessages(filters: Filter<string>[]): string | any[] {
    return filters
      .map(filter => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BitstampRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map(symbol => {
          return {
            event: 'bts:subscribe',
            data: {
              channel: `${filter.channel}_${symbol}`
            }
          }
        })
      })
      .flatMap(c => c)
  }

  protected messageIsError(message: any): boolean {
    return message.channel === undefined
  }

  protected provideManualSnapshots = async (filters: Filter<string>[], snapshotsBuffer: any[], shouldCancel: () => boolean) => {
    // does not work currently due to https://github.com/nodejs/node/issues/27711
    const doesNotWorkInNode12 = true
    const orderBookFilter = filters.find(f => f.channel === 'diff_order_book')
    if (!orderBookFilter || doesNotWorkInNode12) {
      return
    }

    for (let symbol of orderBookFilter.symbols!) {
      if (shouldCancel()) {
        return
      }

      this.debug('requesting manual snapshot for: %s', symbol)

      const depthSnapshotResponse = await got.get(`${this.httpURL}/order_book/${symbol}?group=1`).json()

      const snapshot = {
        data: depthSnapshotResponse,
        event: 'snapshot',
        channel: `diff_order_book_${symbol}`,
        generated: true
      }

      snapshotsBuffer.push(snapshot)
    }
  }
}
