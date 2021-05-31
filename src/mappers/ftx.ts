import { parseμs } from '../handy'
import { BookChange, Trade, DerivativeTicker, Exchange, Liquidation } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://docs.ftx.com/#websocket-api

export class FTXTradesMapper implements Mapper<'ftx' | 'ftx-us', Trade> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: FtxTrades | FtxOrderBook) {
    if (message.data == undefined) {
      return false
    }

    return message.channel === 'trades'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'trades',
        symbols
      } as const
    ]
  }

  *map(ftxTrades: FtxTrades, localTimestamp: Date): IterableIterator<Trade> {
    for (const ftxTrade of ftxTrades.data) {
      const timestamp = new Date(ftxTrade.time)
      timestamp.μs = parseμs(ftxTrade.time)

      yield {
        type: 'trade',
        symbol: ftxTrades.market,
        exchange: this._exchange,
        id: ftxTrade.id !== null ? String(ftxTrade.id) : undefined,
        price: ftxTrade.price,
        amount: ftxTrade.size,
        side: ftxTrade.side,
        timestamp,
        localTimestamp
      }
    }
  }
}

export const mapBookLevel = (level: FtxBookLevel) => {
  const price = level[0]
  const amount = level[1]

  return { price, amount }
}

export class FTXBookChangeMapper implements Mapper<'ftx' | 'ftx-us', BookChange> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: FtxTrades | FtxOrderBook) {
    if (message.data == undefined) {
      return false
    }

    return message.channel === 'orderbook'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'orderbook',
        symbols
      } as const
    ]
  }

  *map(ftxOrderBook: FtxOrderBook, localTimestamp: Date): IterableIterator<BookChange> {
    const isEmptyUpdate = ftxOrderBook.type === 'update' && ftxOrderBook.data.bids.length === 0 && ftxOrderBook.data.asks.length === 0
    if (isEmptyUpdate) {
      return
    }

    const timestamp = new Date(ftxOrderBook.data.time * 1000)
    timestamp.μs = Math.floor(ftxOrderBook.data.time * 1000000) % 1000

    yield {
      type: 'book_change',
      symbol: ftxOrderBook.market,
      exchange: this._exchange,
      isSnapshot: ftxOrderBook.type === 'partial',
      bids: ftxOrderBook.data.bids.map(mapBookLevel),
      asks: ftxOrderBook.data.asks.map(mapBookLevel),
      timestamp,
      localTimestamp
    }
  }
}

export class FTXDerivativeTickerMapper implements Mapper<'ftx', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: FTXInstrument) {
    if (message.data == undefined) {
      return false
    }

    return message.channel === 'instrument'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'instrument',
        symbols: symbols !== undefined ? symbols.filter((s) => s.includes('/') === false) : undefined
      } as const
    ]
  }

  *map(message: FTXInstrument, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.market, this._exchange)
    const { stats, info } = message.data

    if (stats.nextFundingTime !== undefined) {
      pendingTickerInfo.updateFundingTimestamp(new Date(stats.nextFundingTime))
      pendingTickerInfo.updateFundingRate(stats.nextFundingRate)
    }

    pendingTickerInfo.updateIndexPrice(info.index)
    pendingTickerInfo.updateMarkPrice(info.mark)
    pendingTickerInfo.updateLastPrice(info.last)
    pendingTickerInfo.updateOpenInterest(stats.openInterest)
    pendingTickerInfo.updateTimestamp(localTimestamp)

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

export class FTXLiquidationsMapper implements Mapper<'ftx', Liquidation> {
  canHandle(message: FtxTrades | FtxOrderBook) {
    if (message.data == undefined) {
      return false
    }

    return message.channel === 'trades'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'trades',
        symbols
      } as const
    ]
  }

  *map(ftxTrades: FtxTrades, localTimestamp: Date): IterableIterator<Liquidation> {
    for (const ftxTrade of ftxTrades.data) {
      if (ftxTrade.liquidation) {
        const timestamp = new Date(ftxTrade.time)
        timestamp.μs = parseμs(ftxTrade.time)

        yield {
          type: 'liquidation',
          symbol: ftxTrades.market,
          exchange: 'ftx',
          id: ftxTrade.id !== null ? String(ftxTrade.id) : undefined,
          price: ftxTrade.price,
          amount: ftxTrade.size,
          side: ftxTrade.side,
          timestamp,
          localTimestamp
        }
      }
    }
  }
}

type FtxTrades = {
  channel: 'trades'
  market: string
  type: 'update'
  data: {
    id: number | null
    price: number
    size: number
    side: 'buy' | 'sell'
    time: string
    liquidation?: boolean
  }[]
}

type FtxBookLevel = [number, number]

type FtxOrderBook = {
  channel: 'orderbook'
  market: string
  type: 'update' | 'partial'
  data: { time: number; bids: FtxBookLevel[]; asks: FtxBookLevel[] }
}

type FTXInstrument = {
  channel: 'instrument'
  market: string
  type: 'update'
  data: {
    stats: {
      nextFundingRate?: number
      nextFundingTime?: string
      openInterest: number
    }
    info: {
      last: number
      mark: number
      index: number
    }
  }
}
