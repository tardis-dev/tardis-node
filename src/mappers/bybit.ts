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
      const timestamp = trade.trade_time_ms !== undefined ? new Date(Number(trade.trade_time_ms)) : new Date(trade.timestamp)

      yield {
        type: 'trade',
        symbol: trade.symbol,
        exchange: this._exchange,
        id: trade.trade_id,
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
          : message.data
        : [...message.data.delete, ...message.data.update, ...message.data.insert]

    const timestampBybit = Number(message.timestamp_e6)
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

    pendingTickerInfo.updateFundingRate(
      instrumentInfo.funding_rate_e6 !== undefined ? Number(instrumentInfo.funding_rate_e6) / 1000000 : undefined
    )
    pendingTickerInfo.updatePredictedFundingRate(
      instrumentInfo.predicted_funding_rate_e6 !== undefined ? instrumentInfo.predicted_funding_rate_e6 / 1000000 : undefined
    )
    pendingTickerInfo.updateFundingTimestamp(
      instrumentInfo.next_funding_time !== undefined && new Date(instrumentInfo.next_funding_time).valueOf() > 0
        ? new Date(instrumentInfo.next_funding_time)
        : undefined
    )

    if (instrumentInfo.index_price !== undefined) {
      pendingTickerInfo.updateIndexPrice(Number(instrumentInfo.index_price))
    } else if (instrumentInfo.index_price_e4 !== undefined) {
      pendingTickerInfo.updateIndexPrice(Number(instrumentInfo.index_price_e4) / 10000)
    }

    if (instrumentInfo.mark_price !== undefined) {
      pendingTickerInfo.updateMarkPrice(Number(instrumentInfo.mark_price))
    } else if (instrumentInfo.mark_price_e4 !== undefined) {
      pendingTickerInfo.updateMarkPrice(instrumentInfo.mark_price_e4 / 10000)
    }

    if (instrumentInfo.open_interest !== undefined) {
      pendingTickerInfo.updateOpenInterest(instrumentInfo.open_interest)
    } else if (instrumentInfo.open_interest_e8 !== undefined) {
      pendingTickerInfo.updateOpenInterest(instrumentInfo.open_interest_e8 / 100000000)
    }

    if (instrumentInfo.last_price !== undefined) {
      pendingTickerInfo.updateLastPrice(Number(instrumentInfo.last_price))
    } else if (instrumentInfo.last_price_e4 !== undefined) {
      pendingTickerInfo.updateLastPrice(Number(instrumentInfo.last_price_e4) / 10000)
    }

    if (message.timestamp_e6 !== undefined) {
      const timestampBybit = Number(message.timestamp_e6)
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

type BybitTradeDataMessage = BybitDataMessage & {
  data: {
    timestamp: string
    trade_time_ms?: number | string
    symbol: string
    side: 'Buy' | 'Sell'
    size: number
    price: number | string
    trade_id: string
  }[]
}

type BybitBookLevel = {
  price: string
  side: 'Buy' | 'Sell'
  size?: number
}

type BybitBookSnapshotDataMessage = BybitDataMessage & {
  type: 'snapshot'
  data: BybitBookLevel[] | { order_book: BybitBookLevel[] }
  timestamp_e6: number | string
}

type BybitBookSnapshotUpdateMessage = BybitDataMessage & {
  type: 'delta'
  data: {
    delete: BybitBookLevel[]
    update: BybitBookLevel[]
    insert: BybitBookLevel[]
  }
  timestamp_e6: number | string
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
}

type BybitInstrumentDataMessage = BybitDataMessage & {
  timestamp_e6: string
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
