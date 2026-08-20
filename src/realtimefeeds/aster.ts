import { Writable } from 'stream'
import { batch, CircularBuffer, getJSON, wait } from '../handy.ts'
import { Filter } from '../types.ts'
import { MultiConnectionRealTimeFeedBase, PoolingClientBase, RealTimeFeedBase } from './realtimefeed.ts'

export class AsterRealTimeFeed extends RealTimeFeedBase {
  protected static readonly depthChannel = 'depth'
  protected static readonly depthSnapshotChannel = 'depthSnapshot'
  protected readonly depthStream: string = 'depth@100ms'
  private readonly pendingDepthSnapshotSymbols = new Set<string>()
  private readonly bufferedDepthUpdates = new Map<string, CircularBuffer<AsterDepthUpdateData>>()
  protected readonly wssURL: string = 'wss://sstream.asterdex.com/stream'
  protected readonly httpURL: string = 'https://sapi.asterdex.com/api/v3'
  protected readonly channels = new Set([
    'trade',
    'aggTrade',
    'ticker',
    AsterRealTimeFeed.depthChannel,
    AsterRealTimeFeed.depthSnapshotChannel,
    'bookTicker'
  ])
  protected readonly channelMappings: { [key: string]: string | undefined } = {
    [AsterRealTimeFeed.depthChannel]: this.depthStream
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const filtersWithSymbols = filters.map<Required<Filter<string>>>((filter) => {
      if (!this.channels.has(filter.channel)) {
        throw new Error(`AsterRealTimeFeed unsupported channel ${filter.channel}`)
      }

      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('AsterRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return filter as Required<Filter<string>>
    })

    const depthSnapshotFilters = filtersWithSymbols.filter((filter) => filter.channel === AsterRealTimeFeed.depthSnapshotChannel)
    this.validateDepthSnapshotFilters(filtersWithSymbols, depthSnapshotFilters)
    this.resetDepthSnapshotTracking(depthSnapshotFilters)

    return filtersWithSymbols
      .filter((f) => f.channel !== AsterRealTimeFeed.depthSnapshotChannel)
      .map((filter, index) => {
        return {
          method: 'SUBSCRIBE',
          params: filter.symbols.map((symbol) => `${symbol.toLowerCase()}@${this.channelMappings[filter.channel] ?? filter.channel}`),
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

  protected override onMessage(message: any) {
    if (message.stream?.endsWith(`@${this.depthStream}`) !== true || message.data?.s === undefined) {
      return
    }

    const symbol = message.data.s.toUpperCase()
    if (this.pendingDepthSnapshotSymbols.has(symbol) === false) {
      return
    }

    const firstUpdateId = Number(message.data.U)
    const lastUpdateId = Number(message.data.u)
    const previousFinalUpdateId = Number(message.data.pu)
    if (Number.isFinite(lastUpdateId) === false || Number.isFinite(previousFinalUpdateId) === false) {
      return
    }

    const bufferedUpdates = this.bufferedDepthUpdates.get(symbol) ?? new CircularBuffer<AsterDepthUpdateData>(2000)
    bufferedUpdates.append({
      firstUpdateId: Number.isFinite(firstUpdateId) ? firstUpdateId : undefined,
      lastUpdateId,
      previousFinalUpdateId
    })
    this.bufferedDepthUpdates.set(symbol, bufferedUpdates)
  }

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const depthSnapshotFilter = filters.find((f) => f.channel === AsterRealTimeFeed.depthSnapshotChannel)
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

          await this.provideManualSnapshot(symbol, shouldCancel)
        })
      )

      await wait(100)
      this.debug('requested manual snapshots successfully for: %s', symbolsBatch)
    }

    this.debug('requested all manual snapshots successfully')
  }

  private resetDepthSnapshotTracking(filters: Required<Filter<string>>[]) {
    this.pendingDepthSnapshotSymbols.clear()
    this.bufferedDepthUpdates.clear()

    for (const filter of filters) {
      for (const symbol of filter.symbols) {
        const upperCaseSymbol = symbol.toUpperCase()
        this.pendingDepthSnapshotSymbols.add(upperCaseSymbol)
        this.bufferedDepthUpdates.set(upperCaseSymbol, new CircularBuffer<AsterDepthUpdateData>(2000))
      }
    }
  }

  private validateDepthSnapshotFilters(filters: Required<Filter<string>>[], depthSnapshotFilters: Required<Filter<string>>[]) {
    if (depthSnapshotFilters.length === 0) {
      return
    }

    const depthSymbols = new Set(
      filters
        .filter((filter) => filter.channel === AsterRealTimeFeed.depthChannel)
        .flatMap((filter) => filter.symbols.map((symbol) => symbol.toUpperCase()))
    )

    for (const filter of depthSnapshotFilters) {
      for (const symbol of filter.symbols) {
        if (depthSymbols.has(symbol.toUpperCase()) === false) {
          throw new Error(
            `AsterRealTimeFeed requires ${AsterRealTimeFeed.depthChannel} for every ${AsterRealTimeFeed.depthSnapshotChannel} symbol`
          )
        }
      }
    }
  }

  private async provideManualSnapshot(symbol: string, shouldCancel: () => boolean) {
    const maxSnapshotRounds = 4
    const maxSnapshotAttemptsPerRound = 3
    const normalizedSymbol = symbol.toUpperCase()

    for (let round = 0; round < maxSnapshotRounds; round++) {
      for (let attempt = 1; attempt <= maxSnapshotAttemptsPerRound; attempt++) {
        if (shouldCancel()) {
          return
        }

        const { data } = await getJSON<AsterDepthSnapshotData>(`${this.httpURL}/depth?symbol=${symbol}&limit=1000`)
        if (this.snapshotResponseIsValid(data) === false) {
          if (attempt < maxSnapshotAttemptsPerRound) {
            await wait(attempt * 1000)
          }
          continue
        }

        const hasOverlap = await this.waitForSnapshotOverlap(normalizedSymbol, data.lastUpdateId)

        if (shouldCancel()) {
          return
        }

        if (hasOverlap === false) {
          this.trimBufferedUpdates(normalizedSymbol)
          if (attempt < maxSnapshotAttemptsPerRound) {
            await wait(attempt * 1000)
          }
          continue
        }

        if (hasOverlap === true || attempt === maxSnapshotAttemptsPerRound) {
          this.manualSnapshotsBuffer.push(this.createManualSnapshot(symbol, data))
          this.pendingDepthSnapshotSymbols.delete(normalizedSymbol)
          this.bufferedDepthUpdates.delete(normalizedSymbol)
          return
        }
      }
    }

    throw new Error(`AsterRealTimeFeed could not align depth snapshot for ${normalizedSymbol}`)
  }

  private async waitForSnapshotOverlap(symbol: string, lastUpdateId: number) {
    let hasOverlap = this.validateSnapshotOverlap(this.bufferedDepthUpdates.get(symbol), lastUpdateId)
    for (let attempt = 0; attempt < 60; attempt++) {
      if (hasOverlap !== undefined) {
        return hasOverlap
      }

      await wait(100)
      hasOverlap = this.validateSnapshotOverlap(this.bufferedDepthUpdates.get(symbol), lastUpdateId)
    }

    return hasOverlap
  }

  protected validateSnapshotOverlap(bufferedUpdates: CircularBuffer<AsterDepthUpdateData> | undefined, lastUpdateId: number) {
    for (const update of bufferedUpdates?.items() ?? []) {
      if (update.lastUpdateId < lastUpdateId) {
        continue
      }

      return update.previousFinalUpdateId <= lastUpdateId && update.lastUpdateId >= lastUpdateId
    }

    return undefined
  }

  private trimBufferedUpdates(symbol: string) {
    const bufferedUpdates = this.bufferedDepthUpdates.get(symbol)
    if (bufferedUpdates === undefined || bufferedUpdates.count <= 100) {
      return
    }

    const trimmed = new CircularBuffer<AsterDepthUpdateData>(2000)
    for (const update of [...bufferedUpdates.items()].slice(-100)) {
      trimmed.append(update)
    }
    this.bufferedDepthUpdates.set(symbol, trimmed)
  }

  private snapshotResponseIsValid(data: AsterDepthSnapshotData) {
    return Number.isFinite(data.lastUpdateId) && Array.isArray(data.asks) && Array.isArray(data.bids)
  }

  private createManualSnapshot(symbol: string, data: AsterDepthSnapshotData): AsterDepthSnapshotMessage {
    return {
      stream: `${symbol.toLowerCase()}@${AsterRealTimeFeed.depthSnapshotChannel}`,
      generated: true,
      data
    }
  }
}

type AsterDepthSnapshotData = {
  lastUpdateId: number
  bids: string[][]
  asks: string[][]
}

type AsterDepthSnapshotMessage = {
  stream: string
  generated: true
  data: AsterDepthSnapshotData
}

type AsterDepthUpdateData = {
  firstUpdateId?: number
  lastUpdateId: number
  previousFinalUpdateId: number
}

export class AsterFuturesRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const webSocketFilters = filters.filter((filter) => filter.channel !== 'openInterest')
    if (webSocketFilters.length > 0) {
      yield new AsterFuturesWebSocketRealTimeFeed(exchange, webSocketFilters, timeoutIntervalMS, onError)
    }

    const openInterestFilters = filters.filter((filter) => filter.channel === 'openInterest')
    if (openInterestFilters.length > 0) {
      for (const filter of openInterestFilters) {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('AsterFuturesRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }
      }

      yield new AsterFuturesOpenInterestClient(
        exchange,
        'https://fapi.asterdex.com/fapi/v3',
        openInterestFilters.flatMap((filter) => filter.symbols!),
        onError
      )
    }
  }
}

export class AsterFuturesWebSocketRealTimeFeed extends AsterRealTimeFeed {
  protected readonly wssURL: string = 'wss://fstream.asterdex.com/stream'
  protected readonly httpURL: string = 'https://fapi.asterdex.com/fapi/v3'
  protected readonly depthStream = 'depth@0ms'
  protected readonly channels = new Set([
    'trade',
    'aggTrade',
    'ticker',
    AsterRealTimeFeed.depthChannel,
    AsterRealTimeFeed.depthSnapshotChannel,
    'markPrice',
    'forceOrder',
    'bookTicker',
    'assetIndex'
  ])
  protected readonly channelMappings: { [key: string]: string | undefined } = {
    [AsterRealTimeFeed.depthChannel]: this.depthStream,
    markPrice: 'markPrice@1s'
  }

  protected override validateSnapshotOverlap(bufferedUpdates: CircularBuffer<AsterDepthUpdateData> | undefined, lastUpdateId: number) {
    for (const update of bufferedUpdates?.items() ?? []) {
      if (update.lastUpdateId < lastUpdateId) {
        continue
      }

      return (
        (update.firstUpdateId !== undefined && update.firstUpdateId <= lastUpdateId && update.lastUpdateId >= lastUpdateId) ||
        update.previousFinalUpdateId === lastUpdateId
      )
    }

    return undefined
  }
}

class AsterFuturesOpenInterestClient extends PoolingClientBase {
  constructor(
    exchange: string,
    private readonly httpURL: string,
    private readonly instruments: string[],
    onError?: (error: Error) => void
  ) {
    super(exchange, 6, onError)
  }

  protected async poolDataToStream(outputStream: Writable) {
    for (const instrument of this.instruments) {
      if (outputStream.destroyed) {
        return
      }

      const response = await getJSON<AsterFuturesOpenInterestData>(`${this.httpURL}/openInterest?symbol=${instrument.toLowerCase()}`, {
        timeout: 2500
      })

      if (outputStream.writable) {
        outputStream.write({
          stream: `${instrument.toLowerCase()}@openInterest`,
          generated: true,
          data: response.data
        })
      }
    }
  }
}

export type AsterFuturesOpenInterestData = {
  symbol: string
  openInterest: string
  time: number
}
