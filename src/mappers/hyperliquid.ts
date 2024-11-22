import { upperCaseSymbols } from '../handy'
import { BookChange, DerivativeTicker, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

export class HyperliquidTradesMapper implements Mapper<'hyperliquid', Trade> {
  private readonly _seenSymbols = new Set<string>()

  canHandle(message: HyperliquidTradeMessage) {
    return message.channel === 'trades'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trades',
        symbols
      }
    ]
  }

  *map(message: HyperliquidTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const hyperliquidTrade of message.data) {
      if (this._seenSymbols.has(hyperliquidTrade.coin) === false) {
        this._seenSymbols.add(hyperliquidTrade.coin)
        break
      }
      yield {
        type: 'trade',
        symbol: hyperliquidTrade.coin,
        exchange: 'hyperliquid',
        id: hyperliquidTrade.tid.toString(),
        price: Number(hyperliquidTrade.px),
        amount: Number(hyperliquidTrade.sz),
        side: hyperliquidTrade.side === 'B' ? 'buy' : 'sell',
        timestamp: new Date(hyperliquidTrade.time),
        localTimestamp: localTimestamp
      }
    }
  }
}

function mapHyperliquidLevel(level: HyperliquidWsLevel) {
  return {
    price: Number(level.px),
    amount: Number(level.sz)
  }
}
export class HyperliquidBookChangeMapper implements Mapper<'hyperliquid', BookChange> {
  canHandle(message: HyperliquidWsBookMessage) {
    return message.channel === 'l2Book'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'l2Book',
        symbols
      }
    ]
  }

  *map(message: HyperliquidWsBookMessage, localTimestamp: Date): IterableIterator<BookChange> {
    yield {
      type: 'book_change',
      symbol: message.data.coin,
      exchange: 'hyperliquid',
      isSnapshot: true,
      bids: (message.data.levels[0] ? message.data.levels[0] : []).map(mapHyperliquidLevel),
      asks: (message.data.levels[1] ? message.data.levels[1] : []).map(mapHyperliquidLevel),
      timestamp: new Date(message.data.time),
      localTimestamp
    }
  }
}

export class HyperliquidDerivativeTickerMapper implements Mapper<'hyperliquid', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: HyperliquidContextMessage) {
    return message.channel === 'activeAssetCtx'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'activeAssetCtx',
        symbols
      }
    ]
  }

  *map(message: HyperliquidContextMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const symbol = message.data.coin

    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(symbol, 'hyperliquid')

    if (message.data.ctx.funding !== undefined) {
      pendingTickerInfo.updateFundingRate(Number(message.data.ctx.funding))
    }

    if (message.data.ctx.markPx !== undefined) {
      pendingTickerInfo.updateMarkPrice(Number(message.data.ctx.markPx))
    }

    if (message.data.ctx.openInterest !== undefined) {
      pendingTickerInfo.updateOpenInterest(Number(message.data.ctx.openInterest))
    }

    if (message.data.ctx.oraclePx !== undefined) {
      pendingTickerInfo.updateIndexPrice(Number(message.data.ctx.oraclePx))
    }

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

type HyperliquidTradeMessage = {
  channel: 'trades'
  data: [
    {
      coin: string
      side: string
      px: string
      sz: string
      hash: string
      time: number
      tid: number // ID unique across all assets
    }
  ]
}

type HyperliquidWsBookMessage = {
  channel: 'l2Book'
  data: {
    coin: 'ATOM'
    time: 1730160007687
    levels: [HyperliquidWsLevel[], HyperliquidWsLevel[]]
  }
}

type HyperliquidWsLevel = {
  px: string // price
  sz: string // size
  n: number // number of orders
}

type HyperliquidContextMessage = {
  channel: 'activeAssetCtx'
  data: {
    coin: 'RENDER'
    ctx: {
      funding: '0.0000125'
      openInterest: '231067.2'
      prevDayPx: '4.8744'
      dayNtlVlm: '387891.57092'
      premium: '0.0'
      oraclePx: '4.9185'
      markPx: '4.919'
      midPx: '4.9183'
      impactPxs: ['4.9176', '4.9191']
    }
  }
}
