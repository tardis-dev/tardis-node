import { upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, Trade } from '../types'
import { Mapper } from './mapper'

export class OkexSpreadsTradesMapper implements Mapper<'okex-spreads', Trade> {
  canHandle(message: any) {
    if (message.event !== undefined || message.arg === undefined) {
      return false
    }
    return message.arg.channel === 'sprd-public-trades'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: `sprd-public-trades` as const,
        symbols
      }
    ]
  }

  *map(okexTradesMessage: OkexSpreadTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const okexTrade of okexTradesMessage.data) {
      yield {
        type: 'trade',
        symbol: okexTrade.sprdId,
        exchange: 'okex-spreads',
        id: okexTrade.tradeId,
        price: Number(okexTrade.px),
        amount: Number(okexTrade.sz),
        side: okexTrade.side === 'buy' ? 'buy' : 'sell',
        timestamp: new Date(Number(okexTrade.ts)),
        localTimestamp: localTimestamp
      }
    }
  }
}

const mapBookLevel = (level: OkexSpreadBookLevel) => {
  const price = Number(level[0])
  const amount = Number(level[1])

  return { price, amount }
}

export class OkexSpreadsBookChangeMapper implements Mapper<'okex-spreads', BookChange> {
  canHandle(message: any) {
    if (message.event !== undefined || message.arg === undefined) {
      return false
    }

    return message.arg.channel === 'sprd-books5'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'sprd-books5',
        symbols
      }
    ]
  }

  *map(okexDepthDataMessage: OkexSpreadBookMessage, localTimestamp: Date): IterableIterator<BookChange> {
    for (const message of okexDepthDataMessage.data) {
      const timestamp = new Date(Number(message.ts))

      if (timestamp.valueOf() === 0) {
        continue
      }

      yield {
        type: 'book_change',
        symbol: okexDepthDataMessage.arg.sprdId,
        exchange: 'okex-spreads',
        isSnapshot: true,
        bids: message.bids.map(mapBookLevel),
        asks: message.asks.map(mapBookLevel),
        timestamp,
        localTimestamp: localTimestamp
      }
    }
  }
}

export class OkexSpreadsBookTickerMapper implements Mapper<'okex-spreads', BookTicker> {
  canHandle(message: any) {
    if (message.event !== undefined || message.arg === undefined) {
      return false
    }

    return message.arg.channel === 'sprd-bbo-tbt'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: `sprd-bbo-tbt` as const,
        symbols
      }
    ]
  }

  *map(message: OkexSpreadBBOMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    if (!message.data) {
      return
    }

    for (const tbtTicker of message.data) {
      const bestAsk = tbtTicker.asks !== undefined && tbtTicker.asks[0] ? mapBookLevel(tbtTicker.asks[0]) : undefined
      const bestBid = tbtTicker.bids !== undefined && tbtTicker.bids[0] ? mapBookLevel(tbtTicker.bids[0]) : undefined

      const ticker: BookTicker = {
        type: 'book_ticker',
        symbol: message.arg.sprdId,
        exchange: 'okex-spreads',
        askAmount: bestAsk?.amount,
        askPrice: bestAsk?.price,

        bidPrice: bestBid?.price,
        bidAmount: bestBid?.amount,
        timestamp: new Date(Number(tbtTicker.ts)),
        localTimestamp: localTimestamp
      }

      yield ticker
    }
  }
}

type OkexSpreadTradeMessage = {
  arg: { channel: 'sprd-public-trades'; sprdId: 'ETH-USD-SWAP_ETH-USD-240329' }
  data: [
    {
      sprdId: 'ETH-USD-SWAP_ETH-USD-240329'
      tradeId: '2102504804202430464'
      px: '64.9'
      sz: '13430'
      side: 'sell' | 'buy'
      ts: '1703155852033'
    }
  ]
}

type OkexSpreadBookLevel = [string, string, string, string]

type OkexSpreadBookMessage = {
  arg: { channel: 'sprd-books5'; sprdId: 'ETH-USD-231222_ETH-USD-231229' }
  data: [
    {
      bids: OkexSpreadBookLevel[]
      asks: OkexSpreadBookLevel[]
      ts: '1703155852055'
    }
  ]
}

type OkexSpreadBBOMessage = {
  arg: { channel: 'sprd-bbo-tbt'; sprdId: 'BTC-USD-SWAP_BTC-USD-231229' }
  data: [{ bids: [OkexSpreadBookLevel]; asks: [OkexSpreadBookLevel]; ts: '1703155859214' }]
}
