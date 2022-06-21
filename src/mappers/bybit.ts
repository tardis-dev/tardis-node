import { upperCaseSymbols } from '../handy'
import { BookChange, DerivativeTicker, Exchange, Liquidation, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://github.com/bybit-exchange/bybit-official-api-docs/blob/master/en/websocket.md

export class BybitTradesMapper implements Mapper<'bybit', Trade> {
  constructor(private readonly _exchange: Exchange) {}
  canHandle(message: BybitDataMessage) {
    if (message.topic === undefined) {
      return false
    }

    return message.topic.startsWith('trade.')
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

  *map(message: BybitTradeDataMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const trade of message.data) {
      const timestamp =
        'trade_time_ms' in trade
          ? new Date(Number(trade.trade_time_ms))
          : 'tradeTimeMs' in trade
          ? new Date(Number(trade.tradeTimeMs))
          : new Date(trade.timestamp)

      yield {
        type: 'trade',
        symbol: trade.symbol,
        exchange: this._exchange,
        id: 'trade_id' in trade ? trade.trade_id : trade.tradeId,
        price: Number(trade.price),
        amount: trade.size,
        side: trade.side == 'Buy' ? 'buy' : trade.side === 'Sell' ? 'sell' : 'unknown',
        timestamp,
        localTimestamp
      }
    }
  }
}

export class BybitBookChangeMapper implements Mapper<'bybit', BookChange> {
  constructor(protected readonly _exchange: Exchange, private readonly _canUseBook200Channel: boolean) {}

  canHandle(message: BybitDataMessage) {
    if (message.topic === undefined) {
      return false
    }

    if (this._canUseBook200Channel) {
      return message.topic.startsWith('orderBook_200.')
    } else {
      return message.topic.startsWith('orderBookL2_25.')
    }
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    if (this._canUseBook200Channel) {
      return [
        {
          channel: 'orderBook_200',
          symbols
        } as const
      ]
    }

    return [
      {
        channel: 'orderBookL2_25',
        symbols
      } as const
    ]
  }

  *map(message: BybitBookSnapshotDataMessage | BybitBookSnapshotUpdateMessage, localTimestamp: Date) {
    const topicArray = message.topic.split('.')
    const symbol = topicArray[topicArray.length - 1]
    const data =
      message.type === 'snapshot'
        ? 'order_book' in message.data
          ? message.data.order_book
          : 'orderBook' in message.data
          ? message.data.orderBook
          : message.data
        : [...message.data.delete, ...message.data.update, ...message.data.insert]

    // TODO: test instrument info
    // TODO: test liquidations?

    const timestampBybit = message.timestamp_e6 !== undefined ? Number(message.timestamp_e6) : Number(message.timestampE6)
    const timestamp = new Date(timestampBybit / 1000)
    timestamp.μs = timestampBybit % 1000

    yield {
      type: 'book_change',
      symbol,
      exchange: this._exchange,
      isSnapshot: message.type === 'snapshot',
      bids: data.filter((d) => d.side === 'Buy').map(this._mapBookLevel),
      asks: data.filter((d) => d.side === 'Sell').map(this._mapBookLevel),
      timestamp,
      localTimestamp
    } as const
  }

  private _mapBookLevel(level: BybitBookLevel) {
    return { price: Number(level.price), amount: level.size !== undefined ? level.size : 0 }
  }
}

export class BybitDerivativeTickerMapper implements Mapper<'bybit', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: BybitDataMessage) {
    if (message.topic === undefined) {
      return false
    }

    return message.topic.startsWith('instrument_info.')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'instrument_info',
        symbols
      } as const
    ]
  }

  *map(message: BybitInstrumentDataMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const instrumentInfo = 'symbol' in message.data ? message.data : message.data.update[0]

    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(instrumentInfo.symbol, 'bybit')
    const fundingRate = 'funding_rate_e6' in instrumentInfo ? instrumentInfo.funding_rate_e6 : instrumentInfo.fundingRateE6

    pendingTickerInfo.updateFundingRate(fundingRate !== undefined ? Number(fundingRate) / 1000000 : undefined)

    const predictedFundingRate =
      'predicted_funding_rate_e6' in instrumentInfo ? instrumentInfo.predicted_funding_rate_e6 : instrumentInfo.predictedFundingRateE6

    pendingTickerInfo.updatePredictedFundingRate(predictedFundingRate !== undefined ? Number(predictedFundingRate) / 1000000 : undefined)

    const nextFundingTime = 'next_funding_time' in instrumentInfo ? instrumentInfo.next_funding_time : instrumentInfo.nextFundingTime
    pendingTickerInfo.updateFundingTimestamp(
      nextFundingTime !== undefined && new Date(nextFundingTime).valueOf() > 0 ? new Date(nextFundingTime) : undefined
    )

    if (instrumentInfo.index_price !== undefined) {
      pendingTickerInfo.updateIndexPrice(Number(instrumentInfo.index_price))
    } else if (instrumentInfo.indexPrice !== undefined) {
      pendingTickerInfo.updateIndexPrice(Number(instrumentInfo.indexPrice))
    } else if (instrumentInfo.index_price_e4 !== undefined) {
      pendingTickerInfo.updateIndexPrice(Number(instrumentInfo.index_price_e4) / 10000)
    } else if (instrumentInfo.indexPriceE4 !== undefined) {
      pendingTickerInfo.updateIndexPrice(Number(instrumentInfo.indexPriceE4) / 10000)
    }

    if (instrumentInfo.mark_price !== undefined) {
      pendingTickerInfo.updateMarkPrice(Number(instrumentInfo.mark_price))
    } else if (instrumentInfo.markPrice !== undefined) {
      pendingTickerInfo.updateMarkPrice(Number(instrumentInfo.markPrice))
    } else if (instrumentInfo.mark_price_e4 !== undefined) {
      pendingTickerInfo.updateMarkPrice(Number(instrumentInfo.mark_price_e4) / 10000)
    } else if (instrumentInfo.markPriceE4 !== undefined) {
      pendingTickerInfo.updateMarkPrice(Number(instrumentInfo.markPriceE4) / 10000)
    }

    if (instrumentInfo.open_interest !== undefined) {
      pendingTickerInfo.updateOpenInterest(instrumentInfo.open_interest)
    } else if (instrumentInfo.openInterestE8 !== undefined) {
      pendingTickerInfo.updateOpenInterest(Number(instrumentInfo.openInterestE8) / 100000000)
    } else if (instrumentInfo.open_interest_e8 !== undefined) {
      pendingTickerInfo.updateOpenInterest(instrumentInfo.open_interest_e8 / 100000000)
    }

    if (instrumentInfo.last_price !== undefined) {
      pendingTickerInfo.updateLastPrice(Number(instrumentInfo.last_price))
    } else if (instrumentInfo.lastPrice !== undefined) {
      pendingTickerInfo.updateLastPrice(Number(instrumentInfo.lastPrice))
    } else if (instrumentInfo.last_price_e4 !== undefined) {
      pendingTickerInfo.updateLastPrice(Number(instrumentInfo.last_price_e4) / 10000)
    } else if (instrumentInfo.lastPriceE4) {
      pendingTickerInfo.updateLastPrice(Number(instrumentInfo.lastPriceE4) / 10000)
    }

    if (message.timestamp_e6 !== undefined) {
      const timestampBybit = Number(message.timestamp_e6)
      const timestamp = new Date(timestampBybit / 1000)
      timestamp.μs = timestampBybit % 1000
      pendingTickerInfo.updateTimestamp(timestamp)
    } else if (message.timestampE6 !== undefined) {
      const timestampBybit = Number(message.timestampE6)
      const timestamp = new Date(timestampBybit / 1000)
      timestamp.μs = timestampBybit % 1000
      pendingTickerInfo.updateTimestamp(timestamp)
    } else {
      pendingTickerInfo.updateTimestamp(new Date(instrumentInfo.updated_at))
    }

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

export class BybitLiquidationsMapper implements Mapper<'bybit', Liquidation> {
  constructor(private readonly _exchange: Exchange) {}
  canHandle(message: BybitDataMessage) {
    if (message.topic === undefined) {
      return false
    }

    return message.topic.startsWith('liquidation.')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'liquidation',
        symbols
      } as const
    ]
  }

  *map(message: BybitLiquidationMessage | BybitLiquidationNativeMessage, localTimestamp: Date): IterableIterator<Liquidation> {
    // from bybit telegram: When "side":"Buy", a long position was liquidated. Will fix the docs.
    if (message.generated) {
      for (const bybitLiquidation of message.data) {
        const liquidation: Liquidation = {
          type: 'liquidation',
          symbol: bybitLiquidation.symbol,
          exchange: this._exchange,
          id: String(bybitLiquidation.id),
          price: Number(bybitLiquidation.price),
          amount: bybitLiquidation.qty,
          side: bybitLiquidation.side == 'Buy' ? 'sell' : 'buy',
          timestamp: new Date(bybitLiquidation.time),
          localTimestamp
        }

        yield liquidation
      }
    } else {
      const bybitLiquidation = message.data
      const liquidation: Liquidation = {
        type: 'liquidation',
        symbol: bybitLiquidation.symbol,
        exchange: this._exchange,
        id: undefined,
        price: Number(bybitLiquidation.price),
        amount: Number(bybitLiquidation.qty),
        side: bybitLiquidation.side == 'Buy' ? 'sell' : 'buy',
        timestamp: new Date(bybitLiquidation.time),
        localTimestamp
      }

      yield liquidation
    }
  }
}

type BybitDataMessage = {
  topic: string
}

type BybitTradeDataMessage =
  | (BybitDataMessage & {
      data: {
        timestamp: string
        trade_time_ms?: number | string
        symbol: string
        side: 'Buy' | 'Sell'
        size: number
        price: number | string
        trade_id: string
      }[]
    })
  | {
      topic: 'trade.BTCPERP'
      data: [
        {
          symbol: 'BTCPERP'
          tickDirection: 'PlusTick'
          price: '21213.00'
          size: 0.007
          timestamp: '2022-06-21T09:36:58.000Z'
          tradeTimeMs: '1655804218524'
          side: 'Sell'
          tradeId: '7aad7741-f763-5f78-bf43-c38b29a40f67'
        }
      ]
    }

type BybitBookLevel = {
  price: string
  side: 'Buy' | 'Sell'
  size?: number
}

type BybitBookSnapshotDataMessage = BybitDataMessage & {
  type: 'snapshot'
  data: BybitBookLevel[] | { order_book: BybitBookLevel[] } | { orderBook: BybitBookLevel[] }
  timestamp_e6: number | string
  timestampE6: number | string
}

type BybitBookSnapshotUpdateMessage = BybitDataMessage & {
  type: 'delta'
  data: {
    delete: BybitBookLevel[]
    update: BybitBookLevel[]
    insert: BybitBookLevel[]
  }
  timestamp_e6: number | string
  timestampE6: number | string
}

type BybitInstrumentUpdate = {
  symbol: string
  mark_price_e4?: number
  mark_price?: string
  index_price_e4?: string
  index_price?: string
  open_interest?: number
  open_interest_e8?: number
  funding_rate_e6?: string
  predicted_funding_rate_e6?: number
  next_funding_time?: string
  last_price_e4?: string
  last_price?: string
  updated_at: string
  lastPriceE4: '212130000'
  lastPrice: '21213.00'
  lastTickDirection: 'PlusTick'
  prevPrice24hE4: '207180000'
  prevPrice24h: '20718.00'
  price24hPcntE6: '23892'
  highPrice24hE4: '214085000'
  highPrice24h: '21408.50'
  lowPrice24hE4: '198005000'
  lowPrice24h: '19800.50'
  prevPrice1hE4: '213315000'
  prevPrice1h: '21331.50'
  price1hPcntE6: '-5555'
  markPriceE4: '212094700'
  markPrice: '21209.47'
  indexPriceE4: '212247200'
  indexPrice: '21224.72'
  openInterestE8: '18317600000'
  totalTurnoverE8: '94568739311650000'
  turnover24hE8: '1375880657550000'
  totalVolumeE8: '2734659400000'
  volume24hE8: '66536799999'
  fundingRateE6: '-900'
  predictedFundingRateE6: '-614'
  crossSeq: '385207672'
  createdAt: '1970-01-01T00:00:00.000Z'
  updatedAt: '2022-06-21T09:36:58.000Z'
  nextFundingTime: '2022-06-21T16:00:00Z'
  countDownHour: '7'
  bid1PriceE4: '212130000'
  bid1Price: '21213.00'
  ask1PriceE4: '212135000'
  ask1Price: '21213.50'
}

type BybitInstrumentDataMessage =
  | BybitDataMessage & {
      timestamp_e6: string
      timestampE6: string
      data:
        | BybitInstrumentUpdate
        | {
            update: [BybitInstrumentUpdate]
          }
    }

type BybitLiquidationMessage = BybitDataMessage & {
  generated: true
  data: {
    id: number
    qty: number
    side: 'Sell' | 'Buy'
    time: number
    symbol: string
    price: number
  }[]
}

type BybitLiquidationNativeMessage = BybitDataMessage & {
  generated: undefined
  data: { symbol: string; side: 'Sell' | 'Buy'; price: string; qty: string; time: number }
}
