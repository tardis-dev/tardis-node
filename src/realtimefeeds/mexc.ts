import protobuf from 'protobufjs'
import { CircularBuffer, getJSON, wait } from '../handy.ts'
import type { MexcDepthSnapshotMessage } from '../mappers/mexc.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class MexcRealTimeFeed extends RealTimeFeedBase {
  private static readonly jsonObjectStart = '{'.charCodeAt(0)
  private static pushDataV3ApiWrapper: protobuf.Type | undefined
  /**
   * MEXC protobuf docs at @see https://www.mexc.com/api-docs/spot-v3/websocket-market-streams/protocol-buffers-integration
   * and schemas from @see https://github.com/mexcdevelop/websocket-proto, mirrored in tardis-recorder/datafeeds/src/mexc/proto.
   */
  private static readonly pushDataV3ApiWrapperSchema = `
    syntax = "proto3";

    message PushDataV3ApiWrapper {
      string channel = 1;
      oneof body {
        PublicAggreDepthsV3Api publicAggreDepths = 313;
        PublicAggreDealsV3Api publicAggreDeals = 314;
        PublicAggreBookTickerV3Api publicAggreBookTicker = 315;
      }

      optional string symbol = 3;
      optional string symbolId = 4;
      optional int64 createTime = 5;
      optional int64 sendTime = 6;
    }

    message PublicAggreDealsV3Api {
      repeated PublicAggreDealsV3ApiItem deals = 1;
      string eventType = 2;
    }

    message PublicAggreDealsV3ApiItem {
      string price = 1;
      string quantity = 2;
      int32 tradeType = 3;
      int64 time = 4;
      string tradeId = 5;
    }

    message PublicAggreDepthsV3Api {
      repeated PublicAggreDepthV3ApiItem asks = 1;
      repeated PublicAggreDepthV3ApiItem bids = 2;
      string eventType = 3;
      string fromVersion = 4;
      string toVersion = 5;
      int64 lastOrderCreateTime = 6;
    }

    message PublicAggreDepthV3ApiItem {
      string price = 1;
      string quantity = 2;
    }

    message PublicAggreBookTickerV3Api {
      string bidPrice = 1;
      string bidQuantity = 2;
      string askPrice = 3;
      string askQuantity = 4;
      string version = 5;
      int64 lastOrderCreateTime = 6;
    }
  `

  private readonly pendingDepthSnapshotSymbols = new Set<string>()
  private readonly bufferedDepthUpdates = new Map<string, CircularBuffer<MexcDepthUpdateData>>()
  protected readonly wssURL = 'wss://wbs-api.mexc.com/ws'
  protected readonly httpURL: string = 'https://api.mexc.com'
  private readonly channels = new Set([
    'spot@public.aggre.deals.v3.api.pb@10ms',
    'spot@public.aggre.depth.v3.api.pb@10ms',
    'spot@public.aggre.bookTicker.v3.api.pb@10ms'
  ])

  protected override mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const filtersWithSymbols = filters.map<Required<Filter<string>>>((filter) => {
      if (!this.channels.has(filter.channel)) {
        throw new Error(`MexcRealTimeFeed unsupported channel ${filter.channel}`)
      }

      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('MexcRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return filter as Required<Filter<string>>
    })

    this.resetDepthSnapshotTracking(filtersWithSymbols)

    return [
      {
        method: 'SUBSCRIPTION',
        params: filtersWithSymbols.flatMap((filter) => filter.symbols.map((symbol) => `${filter.channel}@${symbol.toUpperCase()}`))
      }
    ]
  }

  protected override parseMessage(message: Buffer<ArrayBufferLike>): any {
    const buffer = Buffer.isBuffer(message) ? message : Buffer.from(message)

    if (buffer.length > 0 && buffer[0] === MexcRealTimeFeed.jsonObjectStart) {
      return JSON.parse(buffer.toString())
    }

    const pushDataV3ApiWrapper = this.getPushDataV3ApiWrapper()
    return pushDataV3ApiWrapper.toObject(pushDataV3ApiWrapper.decode(buffer), {
      longs: String,
      arrays: true
    })
  }

  protected override messageIsError(message: any): boolean {
    return message.code !== undefined && message.code !== 0
  }

  protected override messageIsHeartbeat(message: any) {
    return message.msg === 'PONG'
  }

  protected override onMessage(message: any) {
    if (
      message.channel?.startsWith('spot@public.aggre.depth.v3.api.pb@10ms') !== true ||
      message.symbol === undefined ||
      this.pendingDepthSnapshotSymbols.has(message.symbol) === false
    ) {
      return
    }

    const firstVersion = Number(message.publicAggreDepths?.fromVersion)
    const lastVersion = Number(message.publicAggreDepths?.toVersion)
    if (Number.isFinite(firstVersion) === false || Number.isFinite(lastVersion) === false) {
      return
    }

    const bufferedUpdates = this.bufferedDepthUpdates.get(message.symbol) ?? new CircularBuffer<MexcDepthUpdateData>(2000)
    bufferedUpdates.append({ firstVersion, lastVersion })
    this.bufferedDepthUpdates.set(message.symbol, bufferedUpdates)
  }

  protected override async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const depthFilter = filters.find((filter) => filter.channel === 'spot@public.aggre.depth.v3.api.pb@10ms')
    if (depthFilter === undefined) {
      return
    }

    this.debug('requesting manual snapshots for: %s', depthFilter.symbols!)

    for (const symbol of depthFilter.symbols!) {
      await this.provideManualSnapshot(symbol.toUpperCase(), shouldCancel)
    }

    this.debug('requested manual snapshots successfully for: %s ', depthFilter.symbols!)
  }

  protected sendCustomPing = () => {
    this.send({ method: 'PING' })
  }

  private getPushDataV3ApiWrapper() {
    MexcRealTimeFeed.pushDataV3ApiWrapper ??= protobuf
      .parse(MexcRealTimeFeed.pushDataV3ApiWrapperSchema)
      .root.lookupType('PushDataV3ApiWrapper')

    return MexcRealTimeFeed.pushDataV3ApiWrapper
  }

  private resetDepthSnapshotTracking(filters: Required<Filter<string>>[]) {
    this.pendingDepthSnapshotSymbols.clear()
    this.bufferedDepthUpdates.clear()

    for (const filter of filters) {
      if (filter.channel !== 'spot@public.aggre.depth.v3.api.pb@10ms') {
        continue
      }

      for (const symbol of filter.symbols) {
        const upperCaseSymbol = symbol.toUpperCase()
        this.pendingDepthSnapshotSymbols.add(upperCaseSymbol)
        this.bufferedDepthUpdates.set(upperCaseSymbol, new CircularBuffer<MexcDepthUpdateData>(2000))
      }
    }
  }

  private async provideManualSnapshot(symbol: string, shouldCancel: () => boolean) {
    const maxSnapshotRounds = 4
    const maxSnapshotAttemptsPerRound = 3

    for (let round = 0; round < maxSnapshotRounds; round++) {
      for (let attempt = 1; attempt <= maxSnapshotAttemptsPerRound; attempt++) {
        if (shouldCancel()) {
          return
        }

        const { data } = await getJSON<MexcDepthSnapshotResponse>(`${this.httpURL}/api/v3/depth?symbol=${symbol}&limit=1000`)
        if (this.snapshotResponseIsValid(data) === false) {
          if (attempt < maxSnapshotAttemptsPerRound) {
            await wait(attempt * 1000)
          }
          continue
        }

        const hasOverlap = await this.waitForSnapshotOverlap(symbol, data.lastUpdateId)

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
          this.manualSnapshotsBuffer.push(this.createManualSnapshot(symbol, data))
          this.pendingDepthSnapshotSymbols.delete(symbol)
          this.bufferedDepthUpdates.delete(symbol)
          return
        }
      }
    }

    throw new Error(`MexcRealTimeFeed could not align depth snapshot for ${symbol}`)
  }

  private async waitForSnapshotOverlap(symbol: string, lastUpdateId: number) {
    let hasOverlap = this.validateSnapshotOverlap(symbol, lastUpdateId)
    for (let attempt = 0; attempt < 60; attempt++) {
      if (hasOverlap !== undefined) {
        return hasOverlap
      }

      await wait(100)
      hasOverlap = this.validateSnapshotOverlap(symbol, lastUpdateId)
    }

    return hasOverlap
  }

  private validateSnapshotOverlap(symbol: string, lastUpdateId: number) {
    const bufferedUpdates = this.bufferedDepthUpdates.get(symbol)
    for (const update of bufferedUpdates?.items() ?? []) {
      if (update.lastVersion <= lastUpdateId) {
        continue
      }

      return update.firstVersion <= lastUpdateId + 1 && update.lastVersion >= lastUpdateId + 1
    }

    return undefined
  }

  private trimBufferedUpdates(symbol: string) {
    const bufferedUpdates = this.bufferedDepthUpdates.get(symbol)
    if (bufferedUpdates === undefined || bufferedUpdates.count <= 100) {
      return
    }

    const trimmed = new CircularBuffer<MexcDepthUpdateData>(2000)
    for (const update of [...bufferedUpdates.items()].slice(-100)) {
      trimmed.append(update)
    }
    this.bufferedDepthUpdates.set(symbol, trimmed)
  }

  private snapshotResponseIsValid(data: MexcDepthSnapshotResponse) {
    return Number.isFinite(data.lastUpdateId) && Array.isArray(data.asks) && Array.isArray(data.bids)
  }

  private createManualSnapshot(symbol: string, data: MexcDepthSnapshotResponse): MexcDepthSnapshotMessage {
    return {
      channel: `spot@public.aggre.depth.v3.api.pb@10ms@${symbol}`,
      symbol,
      generated: true,
      publicAggreDepthsSnapshot: {
        lastUpdateId: data.lastUpdateId,
        asks: data.asks,
        bids: data.bids,
        timestamp: data.timestamp
      }
    }
  }
}

type MexcDepthSnapshotResponse = {
  lastUpdateId: number
  bids: [string, string][]
  asks: [string, string][]
  timestamp: number
}

type MexcDepthUpdateData = {
  firstVersion: number
  lastVersion: number
}
