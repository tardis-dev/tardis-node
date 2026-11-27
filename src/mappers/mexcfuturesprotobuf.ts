import { asNumberOrUndefined, upperCaseSymbols } from '../handy.ts'
import type { BookChange, DerivativeTicker, Trade } from '../types.ts'
import { type Mapper, PendingTickerInfoHelper } from './mapper.ts'
import { MexcFuturesBookChangeMapper, type MexcFuturesDepthLevel, type MexcFuturesDepthSnapshotMessage } from './mexcfutures.ts'
import type { decodeMexcFuturesProtobufMessage } from '../realtimefeeds/mexcfuturesprotobuf.ts'

export class MexcFuturesProtobufTradesMapper implements Mapper<'mexc-futures', Trade> {
  canHandle(message: MexcFuturesProtobufMessage) {
    return message.channel === 'push.deal'
  }

  getFilters(symbols: string[] = []) {
    return [{ channel: 'push.deal', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: MexcFuturesProtobufMessage, localTimestamp: Date): IterableIterator<Trade> {
    const deals = message.deal !== undefined ? [message.deal] : (message.deals?.deals ?? [])
    for (const deal of deals) {
      yield {
        type: 'trade',
        symbol: message.symbol,
        exchange: 'mexc-futures',
        id: deal.i,
        price: Number(deal.p),
        amount: Number(deal.v),
        side: deal.t === 1 ? 'buy' : 'sell',
        timestamp: new Date(Number(deal.ts ?? '0')),
        localTimestamp
      }
    }
  }
}

export class MexcFuturesProtobufBookChangeMapper implements Mapper<'mexc-futures', BookChange> {
  private readonly bookMapper: MexcFuturesBookChangeMapper

  constructor(options: { ignoreBookSnapshotOverlapError: boolean }) {
    // JSON and Protobuf share the same REST snapshot and batched depth synchronization contract.
    this.bookMapper = new MexcFuturesBookChangeMapper(options)
  }

  canHandle(message: { channel: string }) {
    return message.channel === 'push.depth' || message.channel === 'push.depth.snapshot'
  }

  getFilters(symbols: string[] = []) {
    return this.bookMapper.getFilters(symbols)
  }

  *map(message: MexcFuturesProtobufMessage | MexcFuturesDepthSnapshotMessage, localTimestamp: Date): IterableIterator<BookChange> {
    if ('generated' in message && message.generated === true) {
      // Snapshot merging updates its working book; leave the exchange-native message untouched.
      yield* this.bookMapper.map(
        {
          ...message,
          data: {
            ...message.data,
            bids: [...message.data.bids],
            asks: [...message.data.asks]
          }
        },
        localTimestamp
      )
      return
    }

    const update = message as MexcFuturesProtobufMessage
    const depth = update.depthMerge!
    yield* this.bookMapper.map(
      {
        channel: 'push.depth',
        symbol: update.symbol,
        ts: Number(update.ts ?? '0'),
        data: {
          asks: this.mapLevels(depth.asks),
          bids: this.mapLevels(depth.bids),
          begin: Number(depth.beginVersion ?? '0'),
          end: Number(depth.endVersion ?? '0'),
          version: Number(depth.endVersion ?? '0')
        }
      },
      localTimestamp
    )
  }

  private mapLevels(levels: MexcFuturesProtobufDepth['asks']): MexcFuturesDepthLevel[] {
    return (levels ?? []).map((level) => [Number(level.price), Number(level.vol), level.count ?? 0])
  }
}

export class MexcFuturesProtobufDerivativeTickerMapper implements Mapper<'mexc-futures', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: MexcFuturesProtobufMessage) {
    return message.channel === 'push.ticker' || message.channel === 'push.funding.rate'
  }

  getFilters(symbols: string[] = []) {
    const normalizedSymbols = upperCaseSymbols(symbols)
    return [
      { channel: 'push.ticker', symbols: normalizedSymbols } as const,
      { channel: 'push.funding.rate', symbols: normalizedSymbols } as const
    ]
  }

  *map(message: MexcFuturesProtobufMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    if (message.channel === 'push.ticker') {
      const ticker = message.tickerDetail!
      if (
        Number(ticker.lastPrice ?? '0') === 0 &&
        Number(ticker.holdVol ?? '0') === 0 &&
        ticker.fairPrice === undefined &&
        ticker.indexPrice === undefined
      ) {
        return
      }
    }

    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.symbol, 'mexc-futures')
    if (message.channel === 'push.funding.rate') {
      const fundingRate = message.fundingRate!
      pendingTickerInfo.updateFundingRate(asNumberOrUndefined(fundingRate.rate))
      const nextSettleTime = asNumberOrUndefined(fundingRate.nextSettleTime)
      pendingTickerInfo.updateFundingTimestamp(nextSettleTime !== undefined ? new Date(nextSettleTime) : undefined)
      return
    }

    const ticker = message.tickerDetail!
    pendingTickerInfo.updateLastPrice(asNumberOrUndefined(ticker.lastPrice))
    pendingTickerInfo.updateOpenInterest(asNumberOrUndefined(ticker.holdVol))
    pendingTickerInfo.updateIndexPrice(asNumberOrUndefined(ticker.indexPrice))
    pendingTickerInfo.updateMarkPrice(asNumberOrUndefined(ticker.fairPrice))
    pendingTickerInfo.updateTimestamp(new Date(Number(ticker.timestamp ?? '0')))
    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

type MexcFuturesProtobufMessage = ReturnType<typeof decodeMexcFuturesProtobufMessage> & {
  channel: string
  symbol: string
}
type MexcFuturesProtobufDepth = NonNullable<MexcFuturesProtobufMessage['depthMerge']>
