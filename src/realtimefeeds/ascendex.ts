import { wait } from '../handy'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class AscendexRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://ascendex.com/api/pro/v2/stream'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const subs = filters
      .filter((f) => f.channel !== 'depth-snapshot-realtime')
      .map((filter) => {
        if (filter.channel === 'futures-pricing-data') {
          return [
            {
              op: 'sub',
              ch: 'futures-pricing-data'
            }
          ]
        }

        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('AscendexRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          return {
            op: 'sub',
            ch: `${filter.channel}:${symbol}`
          }
        })
      })
      .flatMap((f) => f)

    return subs
  }

  protected messageIsError(message: any): boolean {
    return message.m === 'error'
  }

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const depthSnapshotChannel = filters.find((f) => f.channel === 'depth-snapshot-realtime')
    if (!depthSnapshotChannel) {
      return
    }

    await wait(100)

    for (let symbol of depthSnapshotChannel.symbols!) {
      if (shouldCancel()) {
        return
      }

      this.send({
        op: 'req',
        action: 'depth-snapshot-realtime',
        args: { symbol }
      })

      await wait(10)
    }

    this.debug('sent depth-snapshot-realtime "req" for: %s', depthSnapshotChannel.symbols)
  }
}
