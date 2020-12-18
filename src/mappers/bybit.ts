import { BookChange, DerivativeTicker, Exchange, Liquidation, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://github.com/bybit-exchange/bybit-official-api-docs/blob/master/en/websocket.md

export class BybitTradesMapper implements Mapper<'bybit', Trade> {
  private readonly _seenSymbols = new Set<string>()

  constructor(private readonly _exchange: Exchange) {}
  canHandle(message: BybitDataMessage) {
    if (message.topic === undefined) {
      return false
    }

    return message.topic.startsWith('trade.')
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'trade',
        symbols
      } as const
    ]
  }

  *map(message: BybitTradeDataMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const trade of message.data) {
      const symbol = trade.symbol

      const isLinear = symbol.endsWith('USDT')
      // for some reason bybit publishes 'stale' trades for it's linear contracts (trades that already been published before disconnect)
      if (isLinear && this._seenSymbols.has(symbol) === false) {
        this._seenSymbols.add(symbol)
        break
      }

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

    pendingTickerInfo.updateFundingRate(instrumentInfo.funding_rate_e6 !== undefined ? instrumentInfo.funding_rate_e6 / 1000000 : undefined)
    pendingTickerInfo.updatePredictedFundingRate(
      instrumentInfo.predicted_funding_rate_e6 !== undefined ? instrumentInfo.predicted_funding_rate_e6 / 1000000 : undefined
    )
    pendingTickerInfo.updateFundingTimestamp(
      instrumentInfo.next_funding_time !== undefined ? new Date(instrumentInfo.next_funding_time) : undefined
    )
    pendingTickerInfo.updateIndexPrice(instrumentInfo.index_price_e4 !== undefined ? instrumentInfo.index_price_e4 / 10000 : undefined)
    pendingTickerInfo.updateMarkPrice(instrumentInfo.mark_price_e4 !== undefined ? instrumentInfo.mark_price_e4 / 10000 : undefined)
    pendingTickerInfo.updateOpenInterest(
      instrumentInfo.open_interest_e8 !== undefined ? instrumentInfo.open_interest_e8 / 100000000 : instrumentInfo.open_interest
    )
    pendingTickerInfo.updateLastPrice(instrumentInfo.last_price_e4 !== undefined ? instrumentInfo.last_price_e4 / 10000 : undefined)
    pendingTickerInfo.updateTimestamp(new Date(instrumentInfo.updated_at))

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
    return [
      {
        channel: 'liquidation',
        symbols
      } as const
    ]
  }

  *map(message: BybitLiquidationMessage, localTimestamp: Date): IterableIterator<Liquidation> {
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
  index_price_e4?: number
  open_interest?: number
  open_interest_e8?: number
  funding_rate_e6?: number
  predicted_funding_rate_e6?: number
  next_funding_time?: string
  last_price_e4?: number
  updated_at: string
}

type BybitInstrumentDataMessage = BybitDataMessage & {
  data:
    | BybitInstrumentUpdate
    | {
        update: [BybitInstrumentUpdate]
      }
}

type BybitLiquidationMessage = BybitDataMessage & {
  data: {
    id: number
    qty: number
    side: 'Sell' | 'Buy'
    time: number
    symbol: string
    price: number
  }[]
}
