import { optimizeFilters, wait } from '../handy.ts'
import type { Filter } from '../types.ts'
import { MultiConnectionRealTimeFeedBase, RealTimeFeedBase } from './realtimefeed.ts'

const productCategories = new Set(['all', 'call_options', 'put_options', 'move_options', 'spot', 'futures', 'perpetual_futures'])

export class DeltaIndiaRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const marketFilters: Filter<string>[] = []
    const depthFilters: Filter<string>[] = []
    const twapFilters: Filter<string>[] = []

    for (const filter of optimizeFilters(filters)) {
      if (filter.channel !== 'product_updates' && filter.channel !== 'system_status' && !filter.symbols?.length) {
        throw new Error('DeltaIndiaRealTimeFeed requires explicitly specified symbols for market data channels')
      }
      if (filter.channel === 'ob_updates') {
        for (const symbol of filter.symbols!) {
          if (productCategories.has(symbol.toLowerCase()) || /^[A-Z]+-\d{6}$/i.test(symbol)) {
            throw new Error('Delta India ob_updates requires individual instrument symbols')
          }
        }
        depthFilters.push(filter)
      } else if (filter.channel === 'spot_30mtwap_price') {
        twapFilters.push(filter)
      } else {
        marketFilters.push(filter)
      }
    }

    const feeds: DeltaIndiaWebSocketRealTimeFeed[] = [
      marketFilters.length ? new DeltaIndiaWebSocketRealTimeFeed(exchange, marketFilters, timeoutIntervalMS, onError) : undefined,
      depthFilters.length ? new DeltaIndiaWebSocketRealTimeFeed(exchange, depthFilters, timeoutIntervalMS, onError) : undefined,
      twapFilters.length ? new DeltaIndiaTwapRealTimeFeed(exchange, twapFilters, timeoutIntervalMS, onError) : undefined
    ].filter((feed) => feed !== undefined)

    yield* feeds
  }
}

export class DeltaIndiaWebSocketRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL: string = 'wss://public-socket.india.delta.exchange'
  private readonly sequences = new Map<string, number>()
  private readonly pendingSnapshots = new Set<string>()
  private retrySnapshotsAt = 0

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    this.sequences.clear()
    this.pendingSnapshots.clear()
    this.retrySnapshotsAt = Date.now() + 5000

    const channels = filters.map((filter) => {
      if (filter.channel === 'product_updates' || filter.channel === 'system_status') {
        return { name: filter.channel }
      }
      const symbols = [
        ...new Set(
          filter.symbols!.map((symbol) => {
            if (productCategories.has(symbol)) {
              return symbol
            }
            const id = symbol.toUpperCase()
            if (filter.channel === 'mark_price') {
              return id.startsWith('MARK:') ? id : `MARK:${id}`
            }
            if ((filter.channel === 'ticker' || filter.channel === 'ob_l1') && (id.startsWith('C-') || id.startsWith('P-'))) {
              const parts = id.split('-')
              return `${parts[1]}-${parts[3]}`
            }
            return id
          })
        )
      ]
      if (filter.channel === 'ob_updates') {
        for (const symbol of symbols) {
          this.pendingSnapshots.add(symbol)
        }
      }
      return { name: filter.channel, symbols }
    })
    return [{ type: 'subscribe', payload: { channels } }, { type: 'enable_heartbeat' }]
  }

  protected messageIsError(message: any): boolean {
    return (
      message.type === 'error' ||
      message.error != null ||
      (message.type === 'subscriptions' && message.channels.some((channel: { error?: unknown }) => channel.error != null)) ||
      (message.type === 'ob_updates' &&
        message.action === 'error' &&
        message.msg !== 'Snapshot load failed. Verify if product is live and resubscribe after a few secs.')
    )
  }

  protected override onMessage(message: any) {
    if (message.type !== 'ob_updates') {
      return
    }
    if (message.action === 'error') {
      const symbol = message.symbol
      this.sequences.delete(symbol)
      this.pendingSnapshots.add(symbol)
    } else if (message.action === 'snapshot') {
      this.sequences.set(message.sy, message.seq)
      this.pendingSnapshots.delete(message.sy)
    } else if (message.action === 'update') {
      const previous = this.sequences.get(message.sy)
      if (previous === undefined) {
        return
      }
      if (message.seq !== previous + 1) {
        throw new Error(`Delta India order book sequence gap for ${message.sy}: ${previous} -> ${message.seq}`)
      }
      this.sequences.set(message.sy, message.seq)
    }
  }

  protected override async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    if (!filters.some((filter) => filter.channel === 'ob_updates')) {
      return
    }
    // Native snapshots can be missing without an error; retry only those symbols on the same connection.
    while (!shouldCancel()) {
      if (this.pendingSnapshots.size && Date.now() >= this.retrySnapshotsAt) {
        const channels = [{ name: 'ob_updates', symbols: [...this.pendingSnapshots] }]
        this.send({ type: 'unsubscribe', payload: { channels } })
        this.send({ type: 'subscribe', payload: { channels } })
        this.retrySnapshotsAt = Date.now() + 5000
      }
      await wait(1000)
    }
  }

  protected override sendCustomPing = () => this.send({ type: 'ping' })

  protected override messageIsHeartbeat(message: any) {
    return message.type === 'pong' || message.type === 'heartbeat'
  }
}

class DeltaIndiaTwapRealTimeFeed extends DeltaIndiaWebSocketRealTimeFeed {
  protected readonly wssURL = 'wss://socket.india.delta.exchange'
}
