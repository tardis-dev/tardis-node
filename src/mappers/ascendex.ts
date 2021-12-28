import { upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, DerivativeTicker, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

export class AscendexTradesMapper implements Mapper<'ascendex', Trade> {
  canHandle(message: AscendexTrade) {
    return message.m === 'trades'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'trades',
        symbols
      } as const
    ]
  }

  *map(message: AscendexTrade, localTimestamp: Date): IterableIterator<Trade> {
    for (let trade of message.data) {
      yield {
        type: 'trade',
        symbol: message.symbol,
        exchange: 'ascendex',
        id: undefined,
        price: Number(trade.p),
        amount: Number(trade.q),
        side: trade.bm === true ? 'sell' : 'buy',
        timestamp: new Date(trade.ts),
        localTimestamp: localTimestamp
      }
    }
  }
}

export class AscendexBookChangeMapper implements Mapper<'ascendex', BookChange> {
  canHandle(message: AscendexDepthRealTime | AscendexDepthRealTimeSnapshot) {
    return message.m === 'depth-realtime' || message.m === 'depth-snapshot-realtime'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'depth-realtime',
        symbols
      } as const,
      {
        channel: 'depth-snapshot-realtime',
        symbols
      } as const
    ]
  }

  *map(message: AscendexDepthRealTime | AscendexDepthRealTimeSnapshot, localTimestamp: Date): IterableIterator<BookChange> {
    yield {
      type: 'book_change',
      symbol: message.symbol,
      exchange: 'ascendex',
      isSnapshot: message.m === 'depth-snapshot-realtime',
      bids: message.data.bids.map(this.mapBookLevel),
      asks: message.data.asks.map(this.mapBookLevel),
      timestamp: message.data.ts > 0 ? new Date(message.data.ts) : localTimestamp,
      localTimestamp
    }
  }

  protected mapBookLevel(level: AscendexPriceLevel) {
    const price = Number(level[0])
    const amount = Number(level[1])
    return { price, amount }
  }
}

export class AscendexDerivativeTickerMapper implements Mapper<'ascendex', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: AscendexFuturesData | AscendexTrade) {
    return message.m === 'futures-pricing-data' || message.m === 'trades'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'futures-pricing-data',
        symbols: [] as string[]
      } as const,
      {
        channel: 'trades',
        symbols
      } as const
    ]
  }

  *map(message: AscendexFuturesData | AscendexTrade, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    if (message.m === 'trades') {
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.symbol, 'ascendex')
      pendingTickerInfo.updateLastPrice(Number(message.data[message.data.length - 1].p))
      return
    }

    for (const futuresData of message.con) {
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(futuresData.s, 'ascendex')

      pendingTickerInfo.updateIndexPrice(Number(futuresData.ip))
      pendingTickerInfo.updateMarkPrice(Number(futuresData.mp))
      pendingTickerInfo.updateOpenInterest(Number(futuresData.oi))
      pendingTickerInfo.updateTimestamp(new Date(futuresData.t))
      pendingTickerInfo.updateFundingTimestamp(new Date(futuresData.f))
      pendingTickerInfo.updateFundingRate(Number(futuresData.r))

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

export class AscendexBookTickerMapper implements Mapper<'ascendex', BookTicker> {
  canHandle(message: AscendexTicker) {
    return message.m === 'bbo'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'bbo',
        symbols
      } as const
    ]
  }

  *map(message: AscendexTicker, localTimestamp: Date): IterableIterator<BookTicker> {
    const ask = message.data.ask
    const bid = message.data.bid

    yield {
      type: 'book_ticker',
      symbol: message.symbol,
      exchange: 'ascendex',

      askAmount: ask !== undefined && ask[1] !== undefined ? Number(ask[1]) : undefined,
      askPrice: ask !== undefined && ask[0] !== undefined ? Number(ask[0]) : undefined,
      bidPrice: bid !== undefined && bid[0] !== undefined ? Number(bid[0]) : undefined,
      bidAmount: bid !== undefined && bid[1] !== undefined ? Number(bid[1]) : undefined,
      timestamp: new Date(message.data.ts),
      localTimestamp: localTimestamp
    }
  }
}

type AscendexTrade = {
  m: 'trades'
  symbol: string
  data: [{ p: string; q: string; ts: number; bm: boolean; seqnum: number }]
}

type AscendexPriceLevel = [string, string]

type AscendexDepthRealTime = {
  m: 'depth-realtime'
  symbol: 'XRP/USDT'
  data: { ts: 1621814400204; seqnum: 39862426; asks: AscendexPriceLevel[]; bids: AscendexPriceLevel[] }
}

type AscendexDepthRealTimeSnapshot = {
  m: 'depth-snapshot-realtime'
  symbol: 'XRP/USDT'
  data: {
    ts: 0
    seqnum: 39862426
    asks: AscendexPriceLevel[]
    bids: AscendexPriceLevel[]
  }
}

type AscendexTicker = { m: 'bbo'; symbol: string; data: { ts: number; bid?: AscendexPriceLevel; ask?: AscendexPriceLevel } }

type AscendexFuturesData = {
  m: 'futures-pricing-data'
  con: [
    {
      t: 1621814404114
      s: 'BTC-PERP'
      mp: '34878.075977904'
      ip: '34697.17'
      oi: '80.6126'
      r: '0.000093633'
      f: 1621843200000
      fi: 28800000
    }
  ]
}
