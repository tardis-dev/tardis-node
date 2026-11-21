import { EXCHANGE_CHANNELS_INFO } from '../consts.ts'
import { batch, getJSON } from '../handy.ts'
import type { BackpackSnapshotMessage } from '../mappers/backpack.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase, type Sequence } from './realtimefeed.ts'

export class BackpackRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://ws.backpack.exchange'
  protected readonly httpURL: string = 'https://api.backpack.exchange'
  private readonly channels = new Set<string>(EXCHANGE_CHANNELS_INFO.backpack)

  protected getSequence(message: any): Sequence | undefined {
    if (message.stream?.startsWith('depth.')) {
      const { s, U, u } = message.data
      return { key: s, sequence: u, previousSequence: U - 1 }
    }
    return undefined
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    const depthSymbols = new Set(filters.filter((filter) => filter.channel === 'depth').flatMap((filter) => filter.symbols ?? []))
    for (const filter of filters) {
      if (!this.channels.has(filter.channel)) {
        throw new Error(`Unsupported Backpack channel: ${filter.channel}`)
      }
      if (!filter.symbols?.length) {
        throw new Error('Backpack requires explicitly specified symbols for live subscriptions')
      }
      if (filter.channel === 'depthSnapshot' && filter.symbols.some((symbol) => !depthSymbols.has(symbol))) {
        throw new Error('Backpack depthSnapshot requires a depth subscription for each snapshot symbol')
      }
    }

    const params = [
      ...new Set(
        filters
          .filter((filter) => filter.channel !== 'depthSnapshot')
          .flatMap((filter) => filter.symbols!.map((symbol) => `${filter.channel}.${symbol}`))
      )
    ]
    return [{ method: 'SUBSCRIBE', params }]
  }

  protected messageIsError(message: { error?: unknown }) {
    return message.error !== undefined
  }

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const symbols = [...new Set(filters.filter((filter) => filter.channel === 'depthSnapshot').flatMap((filter) => filter.symbols!))]
    for (const instruments of batch(symbols, 4)) {
      if (shouldCancel()) return
      await Promise.all(
        instruments.map(async (symbol) => {
          const { data } = await getJSON<BackpackSnapshotMessage['data']>(
            `${this.httpURL}/api/v1/depth?symbol=${encodeURIComponent(symbol)}`
          )
          if (shouldCancel()) return
          this.manualSnapshotsBuffer.push({ stream: `depthSnapshot.${symbol}`, generated: true, data })
        })
      )
    }
  }
}
