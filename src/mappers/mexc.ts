import { debug } from '../debug.ts'
import { CircularBuffer, upperCaseSymbols } from '../handy.ts'
import { BookChange, BookPriceLevel, BookTicker, Trade } from '../types.ts'
import { Mapper } from './mapper.ts'
import { exchangeMappers, isRealTime } from './registry.ts'

export const mexcMappers = exchangeMappers({
  mexc: {
    trades: () => new MexcTradesMapper(),
    bookChanges: (localTimestamp) => new MexcBookChangeMapper({ ignoreBookSnapshotOverlapError: isRealTime(localTimestamp) === false }),
    bookTickers: () => new MexcBookTickerMapper()
  }
})

export class MexcTradesMapper implements Mapper<'mexc', Trade> {
  private readonly channel = 'spot@public.aggre.deals.v3.api.pb@10ms'

  canHandle(message: MexcTradeMessage | MexcControlMessage) {
    return message.channel?.startsWith(`${this.channel}@`) === true && 'publicAggreDeals' in message
  }

  getFilters(symbols?: string[]) {
    return [{ channel: this.channel, symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: MexcTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const trade of message.publicAggreDeals.deals) {
      yield {
        type: 'trade',
        symbol: message.symbol,
        exchange: 'mexc',
        id: undefined,
        price: Number(trade.price),
        amount: Number(trade.quantity),
        side: trade.tradeType === MexcTradeType.Buy ? 'buy' : 'sell',
        timestamp: new Date(Number(trade.time)),
        localTimestamp
      }
    }
  }
}

export class MexcBookChangeMapper implements Mapper<'mexc', BookChange> {
  private readonly channel = 'spot@public.aggre.depth.v3.api.pb@10ms'
  private readonly symbolDepthInfo: Record<string, MexcDepthInfo> = {}
  private readonly ignoreBookSnapshotOverlapError: boolean

  constructor({ ignoreBookSnapshotOverlapError }: { ignoreBookSnapshotOverlapError: boolean }) {
    this.ignoreBookSnapshotOverlapError = ignoreBookSnapshotOverlapError
  }

  canHandle(message: MexcDepthSnapshotMessage | MexcDepthUpdateMessage | MexcControlMessage) {
    return message.channel?.startsWith(`${this.channel}@`) === true && 'publicAggreDepths' in message
  }

  getFilters(symbols?: string[]) {
    return [{ channel: this.channel, symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: MexcDepthSnapshotMessage | MexcDepthUpdateMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const depthInfo = this.getDepthInfoFor(message.symbol)
    if (message.generated === true) {
      if (depthInfo.snapshotEmitted) {
        return
      }

      let currentBookVersion = Number(message.publicAggreDepths.toVersion)
      const bids = (message.publicAggreDepths.bids ?? []).map(this.mapBookLevel)
      const asks = (message.publicAggreDepths.asks ?? []).map(this.mapBookLevel)

      for (const update of depthInfo.updates.items()) {
        const fromVersion = Number(update.publicAggreDepths.fromVersion)
        const toVersion = Number(update.publicAggreDepths.toVersion)
        if (currentBookVersion >= toVersion) {
          continue
        }

        if (!depthInfo.isContinuityValidated) {
          if (fromVersion > currentBookVersion + 1 || toVersion < currentBookVersion + 1) {
            const message = `MEXC depth snapshot has no overlap with first update, update ${JSON.stringify(update)}, currentBookVersion: ${currentBookVersion}`
            if (this.ignoreBookSnapshotOverlapError) {
              depthInfo.isContinuityValidated = true
              debug(message)
            } else {
              throw new Error(message)
            }
          } else {
            depthInfo.isContinuityValidated = true
          }
        }

        for (const bid of update.publicAggreDepths.bids ?? []) {
          this.applyLevel(bids, this.mapBookLevel(bid))
        }
        for (const ask of update.publicAggreDepths.asks ?? []) {
          this.applyLevel(asks, this.mapBookLevel(ask))
        }
        currentBookVersion = toVersion
      }

      depthInfo.updates.clear()
      depthInfo.currentBookVersion = currentBookVersion
      depthInfo.snapshotEmitted = true

      yield {
        type: 'book_change',
        symbol: message.symbol,
        exchange: 'mexc',
        isSnapshot: true,
        bids,
        asks,
        timestamp: new Date(Number(message.sendTime)),
        localTimestamp
      }

      return
    }

    if (!depthInfo.snapshotEmitted) {
      depthInfo.updates.append(message)
      return
    }

    const fromVersion = Number(message.publicAggreDepths.fromVersion)
    const toVersion = Number(message.publicAggreDepths.toVersion)
    if (toVersion <= depthInfo.currentBookVersion!) {
      return
    }

    if (!depthInfo.isContinuityValidated) {
      if (fromVersion > depthInfo.currentBookVersion! + 1 || toVersion < depthInfo.currentBookVersion! + 1) {
        const errorMessage = `MEXC depth snapshot has no overlap with first update, update ${JSON.stringify(message)}, currentBookVersion: ${depthInfo.currentBookVersion}`
        if (this.ignoreBookSnapshotOverlapError) {
          depthInfo.isContinuityValidated = true
          debug(errorMessage)
        } else {
          throw new Error(errorMessage)
        }
      } else {
        depthInfo.isContinuityValidated = true
      }
    }

    depthInfo.currentBookVersion = toVersion

    yield {
      type: 'book_change',
      symbol: message.symbol,
      exchange: 'mexc',
      isSnapshot: false,
      bids: (message.publicAggreDepths.bids ?? []).map(this.mapBookLevel),
      asks: (message.publicAggreDepths.asks ?? []).map(this.mapBookLevel),
      timestamp: new Date(Number(message.sendTime)),
      localTimestamp
    }
  }

  private applyLevel(bookSide: BookPriceLevel[], levelUpdate: BookPriceLevel) {
    const existingIndex = bookSide.findIndex((level) => level.price === levelUpdate.price)
    if (levelUpdate.amount === 0) {
      if (existingIndex !== -1) {
        bookSide.splice(existingIndex, 1)
      }
      return
    }

    if (existingIndex === -1) {
      bookSide.push(levelUpdate)
    } else {
      bookSide[existingIndex] = levelUpdate
    }
  }

  private mapBookLevel(level: MexcPriceLevel) {
    return {
      price: Number(level.price),
      amount: Number(level.quantity)
    }
  }

  private getDepthInfoFor(symbol: string) {
    if (this.symbolDepthInfo[symbol] === undefined) {
      this.symbolDepthInfo[symbol] = { updates: new CircularBuffer<MexcDepthUpdateMessage>(2000) }
    }

    return this.symbolDepthInfo[symbol]
  }
}

export class MexcBookTickerMapper implements Mapper<'mexc', BookTicker> {
  private readonly channel = 'spot@public.aggre.bookTicker.v3.api.pb@10ms'

  canHandle(message: MexcBookTickerMessage | MexcControlMessage) {
    return message.channel?.startsWith(`${this.channel}@`) === true && 'publicAggreBookTicker' in message
  }

  getFilters(symbols?: string[]) {
    return [{ channel: this.channel, symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: MexcBookTickerMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    yield {
      type: 'book_ticker',
      symbol: message.symbol,
      exchange: 'mexc',
      askAmount: Number(message.publicAggreBookTicker.askQuantity),
      askPrice: Number(message.publicAggreBookTicker.askPrice),
      bidAmount: Number(message.publicAggreBookTicker.bidQuantity),
      bidPrice: Number(message.publicAggreBookTicker.bidPrice),
      timestamp: new Date(Number(message.sendTime)),
      localTimestamp
    }
  }
}

type MexcControlMessage = {
  channel?: undefined
  id?: number
  code?: number
  msg?: string
}

type MexcMappedChannel =
  | 'spot@public.aggre.deals.v3.api.pb@10ms'
  | 'spot@public.aggre.depth.v3.api.pb@10ms'
  | 'spot@public.aggre.bookTicker.v3.api.pb@10ms'
type MexcChannelWithSymbol<TChannel extends MexcMappedChannel> = `${TChannel}@${string}`

type MexcProtobufMessage<TChannel extends MexcMappedChannel> = {
  channel: MexcChannelWithSymbol<TChannel>
  symbol: string
  symbolId?: string
  createTime?: string | number
  sendTime: string | number
}

type MexcTradeMessage = MexcProtobufMessage<'spot@public.aggre.deals.v3.api.pb@10ms'> & {
  publicAggreDeals: {
    eventType: 'spot@public.aggre.deals.v3.api.pb@10ms'
    deals: MexcTrade[]
  }
}

type MexcTrade = {
  price: string
  quantity: string
  tradeType: MexcTradeType
  time: string | number
}

enum MexcTradeType {
  Buy = 1,
  Sell = 2
}

export type MexcDepthSnapshotMessage = MexcProtobufMessage<'spot@public.aggre.depth.v3.api.pb@10ms'> & {
  generated: true
  publicAggreDepths: MexcAggreDepths
}

type MexcDepthUpdateMessage = MexcProtobufMessage<'spot@public.aggre.depth.v3.api.pb@10ms'> & {
  generated?: undefined
  publicAggreDepths: MexcAggreDepths
}

type MexcAggreDepths = {
  eventType: 'spot@public.aggre.depth.v3.api.pb@10ms'
  asks?: MexcPriceLevel[]
  bids?: MexcPriceLevel[]
  fromVersion: string
  toVersion: string
}

type MexcPriceLevel = {
  price: string
  quantity: string
}

type MexcBookTickerMessage = MexcProtobufMessage<'spot@public.aggre.bookTicker.v3.api.pb@10ms'> & {
  publicAggreBookTicker: {
    bidPrice: string
    bidQuantity: string
    askPrice: string
    askQuantity: string
  }
}

type MexcDepthInfo = {
  isContinuityValidated?: boolean
  currentBookVersion?: number
  snapshotEmitted?: boolean
  updates: CircularBuffer<MexcDepthUpdateMessage>
}
