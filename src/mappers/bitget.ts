import { asNumberIfValid, upperCaseSymbols } from '../handy.ts'
import { BookChange, BookTicker, DerivativeTicker, Exchange, Liquidation, Trade } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'

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

export class BitgetV3TradesMapper implements Mapper<'bitget' | 'bitget-futures', Trade> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: BitgetV3TradeMessage) {
    return message.arg.topic === 'publicTrade' && message.action === 'update'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'publicTrade',
        symbols
      } as const
    ]
  }

  *map(message: BitgetV3TradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const trade of message.data) {
      yield {
        type: 'trade',
        symbol: message.arg.symbol,
        exchange: this._exchange,
        id: trade.i,
        price: Number(trade.p),
        amount: Number(trade.v),
        side: trade.S === 'buy' ? 'buy' : 'sell',
        timestamp: new Date(Number(trade.T)),
        localTimestamp
      }
    }
  }
}

export class BitgetV3BookChangeMapper implements Mapper<'bitget' | 'bitget-futures', BookChange> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: BitgetV3OrderbookMessage) {
    return message.arg.topic === 'books' && (message.action === 'snapshot' || message.action === 'update')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'books',
        symbols
      } as const
    ]
  }

  *map(message: BitgetV3OrderbookMessage, localTimestamp: Date): IterableIterator<BookChange> {
    for (const orderbookData of message.data) {
      yield {
        type: 'book_change',
        symbol: message.arg.symbol,
        exchange: this._exchange,
        isSnapshot: message.action === 'snapshot',
        bids: orderbookData.b.map(mapPriceLevel),
        asks: orderbookData.a.map(mapPriceLevel),
        timestamp: new Date(Number(orderbookData.ts)),
        localTimestamp
      }
    }
  }
}

export class BitgetV3BookTickerMapper implements Mapper<'bitget' | 'bitget-futures', BookTicker> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: BitgetV3BBoMessage) {
    return message.arg.topic === 'books1' && message.action === 'snapshot'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'books1',
        symbols
      } as const
    ]
  }

  *map(message: BitgetV3BBoMessage, localTimestamp: Date): IterableIterator<BookTicker> {
    for (const bboMessage of message.data) {
      yield {
        type: 'book_ticker',
        symbol: message.arg.symbol,
        exchange: this._exchange,
        askAmount: bboMessage.a[0] ? asNumberIfValid(bboMessage.a[0][1]) : undefined,
        askPrice: bboMessage.a[0] ? asNumberIfValid(bboMessage.a[0][0]) : undefined,
        bidPrice: bboMessage.b[0] ? asNumberIfValid(bboMessage.b[0][0]) : undefined,
        bidAmount: bboMessage.b[0] ? asNumberIfValid(bboMessage.b[0][1]) : undefined,
        timestamp: new Date(Number(bboMessage.ts)),
        localTimestamp
      }
    }
  }
}

export class BitgetV3DerivativeTickerMapper implements Mapper<'bitget-futures', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: BitgetV3TickerMessage) {
    return message.arg.topic === 'ticker' && (message.action === 'snapshot' || message.action === 'update')
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

  *map(message: BitgetV3TickerMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    for (const tickerMessage of message.data) {
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.arg.symbol, 'bitget-futures')

      pendingTickerInfo.updateIndexPrice(Number(tickerMessage.indexPrice))
      pendingTickerInfo.updateMarkPrice(Number(tickerMessage.markPrice))
      pendingTickerInfo.updateOpenInterest(Number(tickerMessage.openInterest))
      pendingTickerInfo.updateLastPrice(Number(tickerMessage.lastPrice))
      pendingTickerInfo.updateTimestamp(new Date(Number(message.ts)))

      if (tickerMessage.nextFundingTime !== '' && tickerMessage.nextFundingTime !== '0') {
        pendingTickerInfo.updateFundingTimestamp(new Date(Number(tickerMessage.nextFundingTime)))
        pendingTickerInfo.updateFundingRate(Number(tickerMessage.fundingRate))
      }

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

export class BitgetV3LiquidationsMapper implements Mapper<'bitget-futures', Liquidation> {
  canHandle(message: BitgetV3LiquidationMessage) {
    return message.arg.topic === 'liquidation' && message.action === 'update'
  }

  getFilters() {
    return [
      {
        channel: 'liquidation',
        symbols: undefined
      } as const
    ]
  }

  *map(message: BitgetV3LiquidationMessage, localTimestamp: Date): IterableIterator<Liquidation> {
    for (const liquidation of message.data) {
      yield {
        type: 'liquidation',
        symbol: liquidation.symbol,
        exchange: 'bitget-futures',
        id: undefined,
        price: Number(liquidation.price),
        amount: Number(liquidation.amount),
        // Bitget side is position side, normalized side is the liquidated aggressor side.
        side: liquidation.side === 'buy' ? 'sell' : 'buy',
        timestamp: new Date(Number(liquidation.ts)),
        localTimestamp
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

type BitgetV3TradeMessage = {
  action: 'snapshot' | 'update'
  arg: { instType: string; topic: 'publicTrade'; symbol: string }
  data: { i: string; p: string; v: string; S: 'buy' | 'sell'; T: string; L: string; isRPI?: string }[]
  ts: number
}

type BitgetV3BookLevel = [string, string]

type BitgetV3OrderbookMessage = {
  action: 'snapshot' | 'update'
  arg: { instType: string; topic: 'books'; symbol: string }
  data: { a: BitgetV3BookLevel[]; b: BitgetV3BookLevel[]; checksum: number; seq: number; pseq: number; ts: string }[]
  ts: number
}

type BitgetV3BBoMessage = {
  action: 'snapshot'
  arg: { instType: string; topic: 'books1'; symbol: string }
  data: { a: BitgetV3BookLevel[]; b: BitgetV3BookLevel[]; checksum: number; seq: number; pseq: number; ts: string }[]
  ts: number
}

type BitgetV3TickerMessage = {
  action: 'snapshot' | 'update'
  arg: { instType: string; topic: 'ticker'; symbol: string }
  data: [
    {
      highPrice24h: string
      lowPrice24h: string
      openPrice24h: string
      lastPrice: string
      turnover24h: string
      volume24h: string
      bid1Price: string
      ask1Price: string
      bid1Size: string
      ask1Size: string
      price24hPcnt: string
      indexPrice: string
      markPrice: string
      fundingRate: string
      openInterest: string
      deliveryTime: string
      deliveryStartTime: string
      deliveryStatus: string
      nextFundingTime: string
    }
  ]
  ts: number
}

type BitgetV3LiquidationMessage = {
  action: 'update'
  arg: { instType: string; topic: 'liquidation' }
  data: { symbol: string; side: 'buy' | 'sell'; price: string; amount: string; ts: string }[]
  ts: number
}
