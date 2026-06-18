import { CircularBuffer, getJSON, wait } from '../handy.ts'
import type { MexcFuturesDepthSnapshotData, MexcFuturesDepthSnapshotMessage } from '../mappers/mexcfutures.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class MexcFuturesRealTimeFeed extends RealTimeFeedBase {
  private readonly pendingDepthSnapshotSymbols = new Set<string>()
  private readonly bufferedDepthUpdates = new Map<string, CircularBuffer<MexcFuturesDepthUpdateData>>()
  protected readonly wssURL = 'wss://contract.mexc.com'
  protected readonly httpURL: string = 'https://contract.mexc.com'
  protected readonly channelToSubscriptionMethod = new Map([
    ['push.deal', 'sub.deal'],
    ['push.depth', 'sub.depth'],
    ['push.ticker', 'sub.ticker'],
    ['push.index.price', 'sub.index.price'],
    ['push.fair.price', 'sub.fair.price'],
    ['push.funding.rate', 'sub.funding.rate'],
    ['push.contract', 'sub.contract']
  ])

  protected override sendCustomPing = () => {
    this.send({ method: 'ping' })
  }

  protected override async getWebSocketUrl() {
    return 'wss://contract.mexc.com/edge'
  }

  protected override mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const filtersWithSymbols = filters.map<Required<Filter<string>>>((filter) => {
      if (filter.channel === 'push.contract') {
        return { ...filter, symbols: [] }
      }

      if (this.channelToSubscriptionMethod.has(filter.channel) === false) {
        throw new Error(`Unsupported MEXC futures channel ${filter.channel}`)
      }

      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('MexcFuturesRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return filter as Required<Filter<string>>
    })

    this.resetDepthSnapshotTracking(filtersWithSymbols.filter((filter) => filter.channel === 'push.depth'))

    return filtersWithSymbols.flatMap((filter) => {
      if (filter.channel === 'push.contract') {
        return [{ method: this.channelToSubscriptionMethod.get(filter.channel) }]
      }

      return filter.symbols.map((symbol) => ({
        method: this.channelToSubscriptionMethod.get(filter.channel),
        param: { symbol },
        gzip: false
      }))
    })
  }

  private resetDepthSnapshotTracking(filters: Required<Filter<string>>[]) {
    this.pendingDepthSnapshotSymbols.clear()
    this.bufferedDepthUpdates.clear()

    for (const filter of filters) {
      for (const symbol of filter.symbols) {
        const upperCaseSymbol = symbol.toUpperCase()
        this.pendingDepthSnapshotSymbols.add(upperCaseSymbol)
        this.bufferedDepthUpdates.set(upperCaseSymbol, new CircularBuffer<MexcFuturesDepthUpdateData>(2000))
      }
    }
  }

  protected override onMessage(message: any) {
    if (
      message.channel !== 'push.depth' ||
      message.symbol === undefined ||
      this.pendingDepthSnapshotSymbols.has(message.symbol) === false
    ) {
      return
    }

    const firstVersion = Number(message.data?.begin ?? message.data?.version)
    const lastVersion = Number(message.data?.end ?? message.data?.version)
    if (Number.isFinite(firstVersion) === false || Number.isFinite(lastVersion) === false) {
      return
    }

    const bufferedUpdates = this.bufferedDepthUpdates.get(message.symbol) ?? new CircularBuffer<MexcFuturesDepthUpdateData>(2000)
    bufferedUpdates.append({ firstVersion, lastVersion })
    this.bufferedDepthUpdates.set(message.symbol, bufferedUpdates)
  }

  protected override async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const depthFilter = filters.find((filter) => filter.channel === 'push.depth')
    if (depthFilter === undefined) {
      return
    }

    this.debug('requesting manual snapshots for: %s', depthFilter.symbols!)

    for (const symbol of depthFilter.symbols!) {
      await this.provideManualSnapshot(symbol.toUpperCase(), shouldCancel)
    }

    this.debug('requested manual snapshots successfully for: %s ', depthFilter.symbols!)
  }

  protected override messageIsError(message: any): boolean {
    return message.channel === 'rs.error' || message.success === false || message.error !== undefined
  }

  protected override messageIsHeartbeat(message: any) {
    return message.channel === 'pong'
  }

  private async provideManualSnapshot(symbol: string, shouldCancel: () => boolean) {
    const maxSnapshotRounds = 4
    const maxSnapshotAttemptsPerRound = 3

    for (let round = 0; round < maxSnapshotRounds; round++) {
      for (let attempt = 1; attempt <= maxSnapshotAttemptsPerRound; attempt++) {
        if (shouldCancel()) {
          return
        }

        const { data } = await getJSON<MexcFuturesDepthSnapshotResponse>(`${this.httpURL}/api/v1/contract/depth/${symbol}?limit=1000`)
        if (this.snapshotResponseIsValid(data) === false) {
          if (attempt < maxSnapshotAttemptsPerRound) {
            await wait(attempt * 1000)
          }
          continue
        }

        const hasOverlap = await this.waitForSnapshotOverlap(symbol, data.data.version)

        if (shouldCancel()) {
          return
        }

        if (hasOverlap === false) {
          this.trimBufferedUpdates(symbol)
          if (attempt < maxSnapshotAttemptsPerRound) {
            await wait(attempt * 1000)
          }
          continue
        }

        if (hasOverlap === true || attempt === maxSnapshotAttemptsPerRound) {
          this.manualSnapshotsBuffer.push(this.createManualSnapshot(symbol, data.data))
          this.pendingDepthSnapshotSymbols.delete(symbol)
          this.bufferedDepthUpdates.delete(symbol)
          return
        }
      }
    }

    throw new Error(`MexcFuturesRealTimeFeed could not align depth snapshot for ${symbol}`)
  }

  private async waitForSnapshotOverlap(symbol: string, snapshotVersion: number) {
    let hasOverlap = this.validateSnapshotOverlap(symbol, snapshotVersion)
    for (let attempt = 0; attempt < 60; attempt++) {
      if (hasOverlap !== undefined) {
        return hasOverlap
      }

      await wait(100)
      hasOverlap = this.validateSnapshotOverlap(symbol, snapshotVersion)
    }

    return hasOverlap
  }

  private validateSnapshotOverlap(symbol: string, snapshotVersion: number) {
    const bufferedUpdates = this.bufferedDepthUpdates.get(symbol)
    for (const update of bufferedUpdates?.items() ?? []) {
      if (update.lastVersion <= snapshotVersion) {
        continue
      }

      return update.firstVersion <= snapshotVersion + 1 && update.lastVersion >= snapshotVersion + 1
    }

    return undefined
  }

  private trimBufferedUpdates(symbol: string) {
    const bufferedUpdates = this.bufferedDepthUpdates.get(symbol)
    if (bufferedUpdates === undefined || bufferedUpdates.count <= 100) {
      return
    }

    const trimmed = new CircularBuffer<MexcFuturesDepthUpdateData>(2000)
    for (const update of [...bufferedUpdates.items()].slice(-100)) {
      trimmed.append(update)
    }
    this.bufferedDepthUpdates.set(symbol, trimmed)
  }

  private snapshotResponseIsValid(response: MexcFuturesDepthSnapshotResponse) {
    return (
      response.success === true &&
      response.code === 0 &&
      response.data !== undefined &&
      Number.isFinite(response.data.version) &&
      response.data.version > 0 &&
      Array.isArray(response.data.asks) &&
      Array.isArray(response.data.bids)
    )
  }

  private createManualSnapshot(symbol: string, data: MexcFuturesDepthSnapshotData): MexcFuturesDepthSnapshotMessage {
    return {
      channel: 'push.depth',
      symbol,
      generated: true,
      ts: Date.now(),
      data: {
        asks: data.asks,
        bids: data.bids,
        version: data.version
      }
    }
  }
}

type MexcFuturesDepthSnapshotResponse = {
  success: boolean
  code: number
  message?: string
  data: MexcFuturesDepthSnapshotData
}

type MexcFuturesDepthUpdateData = {
  firstVersion: number
  lastVersion: number
}
