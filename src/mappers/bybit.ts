import { BookChange, DerivativeTicker, Exchange, Trade } from '../types'
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
    return [
      {
        channel: 'trade',
        symbols
      } as const
    ]
  }

  *map(message: BybitTradeDataMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const trade of message.data) {
      yield {
        type: 'trade',
        symbol: trade.symbol,
        exchange: this._exchange,
        id: trade.trade_id,
        price: trade.price,
        amount: trade.size,
        side: trade.side == 'Buy' ? 'buy' : trade.side === 'Sell' ? 'sell' : 'unknown',
        timestamp: new Date(trade.timestamp),
        localTimestamp: localTimestamp
      }
    }
  }
}

export class BybitBookChangeMapper implements Mapper<'bybit', BookChange> {
  constructor(protected readonly _exchange: Exchange) {}

  canHandle(message: BybitDataMessage) {
    if (message.topic === undefined) {
      return false
    }

    return message.topic.startsWith('orderBookL2_25.')
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'orderBookL2_25',
        symbols
      } as const
    ]
  }

  *map(message: BybitBookSnapshotDataMessage | BybitBookSnapshotUpdateMessage, localTimestamp: Date) {
    const symbol = message.topic.split('.')[1]
    const data = message.type === 'snapshot' ? message.data : [...message.data.delete, ...message.data.update, ...message.data.insert]

    yield {
      type: 'book_change',
      symbol,
      exchange: this._exchange,
      isSnapshot: message.type === 'snapshot',
      bids: data.filter(d => d.side === 'Buy').map(this._mapBookLevel),
      asks: data.filter(d => d.side === 'Sell').map(this._mapBookLevel),
      timestamp: new Date(message.timestamp_e6 / 1000),
      localTimestamp: localTimestamp
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
    pendingTickerInfo.updateIndexPrice(instrumentInfo.index_price_e4 !== undefined ? instrumentInfo.index_price_e4 / 10000 : undefined)
    pendingTickerInfo.updateMarkPrice(instrumentInfo.mark_price_e4 !== undefined ? instrumentInfo.mark_price_e4 / 10000 : undefined)
    pendingTickerInfo.updateOpenInterest(instrumentInfo.open_interest)
    pendingTickerInfo.updateLastPrice(instrumentInfo.last_price_e4 !== undefined ? instrumentInfo.last_price_e4 / 10000 : undefined)
    pendingTickerInfo.updateTimestamp(new Date(instrumentInfo.updated_at))

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

type BybitDataMessage = {
  topic: string
}

type BybitTradeDataMessage = BybitDataMessage & {
  data: {
    timestamp: string
    symbol: string
    side: 'Buy' | 'Sell'
    size: number
    price: number
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
  data: BybitBookLevel[]
  timestamp_e6: number
}

type BybitBookSnapshotUpdateMessage = BybitDataMessage & {
  type: 'delta'
  data: {
    delete: BybitBookLevel[]
    update: BybitBookLevel[]
    insert: BybitBookLevel[]
  }
  timestamp_e6: number
}

type BybitInstrumentUpdate = {
  symbol: string
  mark_price_e4?: number
  index_price_e4?: number
  open_interest?: number
  funding_rate_e6?: number
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
