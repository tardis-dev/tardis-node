import { upperCaseSymbols } from '../handy'
import { BookChange, DerivativeTicker, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://docs.coinflex.com/v2/#websocket-api-subscriptions-public

export const coinflexTradesMapper: Mapper<'coinflex', Trade> = {
  canHandle(message: CoinflexTrades) {
    return message.table === 'trade'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trade',
        symbols
      }
    ]
  },

  *map(coinflexTrades: CoinflexTrades, localTimestamp: Date): IterableIterator<Trade> {
    for (const trade of coinflexTrades.data) {
      yield {
        type: 'trade',
        symbol: trade.marketCode,
        exchange: 'coinflex',
        id: trade.tradeId,
        price: Number(trade.price),
        amount: Number(trade.quantity),
        side: trade.side === 'SELL' ? 'sell' : 'buy',
        timestamp: new Date(Number(trade.timestamp)),
        localTimestamp: localTimestamp
      }
    }
  }
}

const mapBookLevel = (level: CoinflexBookLevel) => {
  const price = Number(level[0])
  const amount = Number(level[1])

  return { price, amount }
}

export const coinflexBookChangeMapper: Mapper<'coinflex', BookChange> = {
  canHandle(message: CoinflexBookDepthMessage) {
    return message.table === 'futures/depth'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'futures/depth',
        symbols
      }
    ]
  },

  *map(depthMessage: CoinflexBookDepthMessage, localTimestamp: Date): IterableIterator<BookChange> {
    for (const change of depthMessage.data) {
      yield {
        type: 'book_change',
        symbol: change.instrumentId,
        exchange: 'coinflex',
        isSnapshot: depthMessage.action === 'partial',
        bids: change.bids.map(mapBookLevel),
        asks: change.asks.map(mapBookLevel),
        timestamp: new Date(Number(change.timestamp)),
        localTimestamp
      }
    }
  }
}

export class CoinflexDerivativeTickerMapper implements Mapper<'coinflex', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: CoinflexTickerMessage) {
    return message.table === 'ticker'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'ticker',
        symbols
      } as const
    ]
  }

  *map(message: CoinflexTickerMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    for (const ticker of message.data) {
      // exclude spot symbols
      if (ticker.marketCode.split('-').length === 2) {
        continue
      }

      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(ticker.marketCode, 'coinflex')

      if (ticker.markPrice !== undefined) {
        pendingTickerInfo.updateMarkPrice(Number(ticker.markPrice))
      }

      if (ticker.openInterest !== undefined) {
        pendingTickerInfo.updateOpenInterest(Number(ticker.openInterest))
      }
      if (ticker.last !== undefined) {
        pendingTickerInfo.updateLastPrice(Number(ticker.last))
      }

      pendingTickerInfo.updateTimestamp(new Date(Number(ticker.timestamp)))

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

type CoinflexTrades = {
  data: [
    {
      side: 'SELL' | 'BUY'
      quantity: string
      price: string
      marketCode: string
      tradeId: string
      timestamp: string
    }
  ]
  table: 'trade'
}

type CoinflexBookLevel = [number | string, number | string]

type CoinflexBookDepthMessage = {
  data: [
    {
      instrumentId: string
      asks: CoinflexBookLevel[]
      bids: CoinflexBookLevel[]
      timestamp: string
    }
  ]
  action: 'partial'
  table: 'futures/depth'
}

type CoinflexTickerMessage = {
  data: [
    {
      last: string
      markPrice?: string
      marketCode: string
      openInterest: string
      timestamp: string
    }
  ]
  table: 'ticker'
}
