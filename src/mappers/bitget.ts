import { upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, DerivativeTicker, Exchange, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

export class BitgetTradesMapper implements Mapper<'bitget' | 'bitget-futures', Trade> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: BitgetTradeMessage) {
    return message.arg.channel === 'trade' && message.action === 'update'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trade',
        symbols
      } as const
    ]
  }

  *map(message: BitgetTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (let trade of message.data) {
      yield {
        type: 'trade',
        symbol: message.arg.instId,
        exchange: this._exchange,
        id: trade.tradeId,
        price: Number(trade.price),
        amount: Number(trade.size),
        side: trade.side === 'buy' ? 'buy' : 'sell',
        timestamp: new Date(Number(trade.ts)),
        localTimestamp: localTimestamp
      }
    }
  }
}

function mapPriceLevel(level: [string, string]) {
  return {
    price: Number(level[0]),
    amount: Number(level[1])
  }
}
export class BitgetBookChangeMapper implements Mapper<'bitget' | 'bitget-futures', BookChange> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: BitgetOrderbookMessage) {
    return message.arg.channel === 'books15' && message.action === 'snapshot'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'books15',
        symbols
      } as const
    ]
  }

  *map(message: BitgetOrderbookMessage, localTimestamp: Date): IterableIterator<BookChange> {
    for (let orderbookData of message.data) {
      yield {
        type: 'book_change',
        symbol: message.arg.instId,
        exchange: this._exchange,
        isSnapshot: message.action === 'snapshot',
        bids: orderbookData.bids.map(mapPriceLevel),
        asks: orderbookData.asks.map(mapPriceLevel),
        timestamp: new Date(Number(orderbookData.ts)),
        localTimestamp
      }
    }
  }
}

export class BitgetBookTickerMapper implements Mapper<'bitget' | 'bitget-futures', BookTicker> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: BitgetBBoMessage) {
    return message.arg.channel === 'books1' && message.action === 'snapshot'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: `books1` as const,
        symbols
      }
    ]
  }

  *map(message: BitgetBBoMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    for (const bboMessage of message.data) {
      const ticker: BookTicker = {
        type: 'book_ticker',
        symbol: message.arg.instId,
        exchange: this._exchange,

        askAmount: bboMessage.asks[0] ? Number(bboMessage.asks[0][1]) : undefined,
        askPrice: bboMessage.asks[0] ? Number(bboMessage.asks[0][0]) : undefined,

        bidPrice: bboMessage.bids[0] ? Number(bboMessage.bids[0][0]) : undefined,
        bidAmount: bboMessage.bids[0] ? Number(bboMessage.bids[0][1]) : undefined,
        timestamp: new Date(Number(bboMessage.ts)),
        localTimestamp: localTimestamp
      }

      yield ticker
    }
  }
}

export class BitgetDerivativeTickerMapper implements Mapper<'bitget-futures', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: BitgetTickerMessage) {
    return message.arg.channel === 'ticker' && message.action === 'snapshot'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'ticker',
        symbols
      } as const
    ]
  }

  *map(message: BitgetTickerMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    for (const tickerMessage of message.data) {
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(tickerMessage.symbol, 'bitget-futures')

      pendingTickerInfo.updateIndexPrice(Number(tickerMessage.indexPrice))
      pendingTickerInfo.updateMarkPrice(Number(tickerMessage.markPrice))
      pendingTickerInfo.updateOpenInterest(Number(tickerMessage.holdingAmount))
      pendingTickerInfo.updateLastPrice(Number(tickerMessage.lastPr))

      pendingTickerInfo.updateTimestamp(new Date(Number(tickerMessage.ts)))

      if (tickerMessage.nextFundingTime !== '0') {
        pendingTickerInfo.updateFundingTimestamp(new Date(Number(tickerMessage.nextFundingTime)))
        pendingTickerInfo.updateFundingRate(Number(tickerMessage.fundingRate))
      }

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

type BitgetTradeMessage = {
  action: 'update'
  arg: { instType: 'SPOT'; channel: 'trade'; instId: 'OPUSDT' }
  data: [{ ts: '1730332800983'; price: '1.717'; size: '56.16'; side: 'buy'; tradeId: '1235670816495050754' }]
  ts: 1730332800989
}

type BitgetOrderbookMessage = {
  action: 'snapshot'
  arg: { instType: 'SPOT'; channel: 'books15'; instId: 'GEMSUSDT' }
  data: [
    {
      asks: [['0.22816', '155.25']]
      bids: [['0.22785', '73.41']]
      checksum: 0
      ts: '1730963759993'
    }
  ]
  ts: 1730963759997
}

type BitgetBBoMessage = {
  action: 'snapshot'
  arg: { instType: 'SPOT'; channel: 'books1'; instId: 'METISUSDT' }
  data: [{ asks: [['44.90', '0.6927']]; bids: [['44.82', '3.5344']]; checksum: 0; ts: '1730332859988' }]
  ts: 1730332859989
}

type BitgetTickerMessage = {
  action: 'snapshot'
  arg: { instType: 'COIN-FUTURES'; channel: 'ticker'; instId: 'BTCUSD' }
  data: [
    {
      instId: 'BTCUSD'
      lastPr: '72331.5'
      bidPr: '72331.5'
      askPr: '72331.8'
      bidSz: '7.296'
      askSz: '0.02'
      open24h: '72047.8'
      high24h: '72934.8'
      low24h: '71422.8'
      change24h: '-0.00561'
      fundingRate: '0.000116'
      nextFundingTime: string
      markPrice: string
      indexPrice: string
      holdingAmount: string
      baseVolume: '7543.376'
      quoteVolume: '544799876.924'
      openUtc: '72335.3'
      symbolType: '1'
      symbol: 'BTCUSD'
      deliveryPrice: '0'
      ts: '1730332823217'
    }
  ]
  ts: 1730332823220
}
