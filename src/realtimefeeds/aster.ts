import { batch, getJSON, wait } from '../handy.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class AsterRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL: string = 'wss://sstream.asterdex.com/stream'
  protected readonly httpURL: string = 'https://sapi.asterdex.com/api/v3'
  protected readonly channelMappings: { [key: string]: string | undefined } = {
    depth: 'depth@100ms'
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters
      .filter((f) => f.channel !== 'depthSnapshot')
      .map((filter, index) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('AsterRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        const channel = this.channelMappings[filter.channel] ?? filter.channel

        return {
          method: 'SUBSCRIBE',
          params: filter.symbols.map((symbol) => `${symbol.toLowerCase()}@${channel}`),
          id: index + 1
        }
      })
  }

  protected messageIsError(message: any): boolean {
    if (message.result === null) {
      return false
    }

    if (message.stream !== undefined) {
      return false
    }

    if (message.code !== undefined || message.error !== undefined) {
      return true
    }

    return false
  }

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const depthSnapshotFilter = filters.find((f) => f.channel === 'depthSnapshot')
    if (!depthSnapshotFilter) {
      return
    }

    for (const symbolsBatch of batch(depthSnapshotFilter.symbols!, 4)) {
      if (shouldCancel()) {
        return
      }

      this.debug('requesting manual snapshots for: %s', symbolsBatch)

      await Promise.all(
        symbolsBatch.map(async (symbol) => {
          if (shouldCancel()) {
            return
          }

          const depthSnapshotResponse = await getJSON<any>(`${this.httpURL}/depth?symbol=${symbol}&limit=1000`)

          this.manualSnapshotsBuffer.push({
            stream: `${symbol.toLowerCase()}@depthSnapshot`,
            generated: true,
            data: depthSnapshotResponse.data
          })
        })
      )

      await wait(100)
      this.debug('requested manual snapshots successfully for: %s', symbolsBatch)
    }

    this.debug('requested all manual snapshots successfully')
  }
}

export class AsterFuturesRealTimeFeed extends AsterRealTimeFeed {
  protected readonly wssURL = 'wss://fstream.asterdex.com/stream'
  protected readonly httpURL = 'https://fapi.asterdex.com/fapi/v1'
  protected readonly channelMappings: { [key: string]: string | undefined } = {
    depth: 'depth@100ms',
    markPrice: 'markPrice@1s'
  }
}
