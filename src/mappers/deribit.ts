import { DataType, DerivativeTicker, Trade, BookChange, FilterForExchange } from '../types'
import { MapperBase } from './mapper'

// https://docs.deribit.com/v2/#subscriptions

export class DeribitMapper extends MapperBase {
  public supportedDataTypes = ['trade', 'book_change', 'derivative_ticker'] as const

  private readonly _dataTypeChannelMapping: { [key in DataType]: FilterForExchange['deribit']['channel'] } = {
    book_change: 'book',
    trade: 'trades',
    derivative_ticker: 'ticker'
  }

  protected mapDataTypeAndSymbolsToFilters(dataType: DataType, symbols?: string[]) {
    const channel = this._dataTypeChannelMapping[dataType]
    return [
      {
        channel,
        symbols
      }
    ]
  }

  protected detectDataType(message: any): DataType | undefined {
    const channel = message.params && (message.params.channel as string | undefined)

    if (channel === undefined) {
      return
    }

    if (channel.startsWith(this._dataTypeChannelMapping.trade)) {
      return 'trade'
    }

    if (channel.startsWith(this._dataTypeChannelMapping.book_change)) {
      return 'book_change'
    }

    if (channel.startsWith(this._dataTypeChannelMapping.derivative_ticker)) {
      return 'derivative_ticker'
    }

    return
  }

  protected *mapTrades(message: DeribitTradesMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const deribitTrade of message.params.data) {
      yield {
        type: 'trade',
        symbol: deribitTrade.instrument_name,
        exchange: this.exchange,
        id: deribitTrade.trade_id,
        price: deribitTrade.price,
        amount: deribitTrade.amount,
        side: deribitTrade.direction,
        timestamp: new Date(deribitTrade.timestamp),
        localTimestamp: localTimestamp
      }
    }
  }

  protected *mapDerivativeTickerInfo(message: DeribitTickerMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const deribitTicker = message.params.data
    const pendingTickerInfo = this.getPendingTickerInfo(deribitTicker.instrument_name)

    pendingTickerInfo.updateFundingRate(deribitTicker.funding_8h)
    pendingTickerInfo.updateIndexPrice(deribitTicker.index_price)
    pendingTickerInfo.updateMarkPrice(deribitTicker.mark_price)
    pendingTickerInfo.updateOpenInterest(deribitTicker.open_interest)
    pendingTickerInfo.updateLastPrice(deribitTicker.last_price)

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(new Date(deribitTicker.timestamp), localTimestamp)
    }
  }

  protected *mapOrderBookChanges(message: DeribitBookMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const deribitBookChange = message.params.data
    // snapshots do not have prev_change_id set
    const isSnapshot = deribitBookChange.prev_change_id === undefined

    yield {
      type: 'book_change',
      symbol: deribitBookChange.instrument_name,
      exchange: this.exchange,
      isSnapshot,
      bids: deribitBookChange.bids.map(this._mapBookLevel),
      asks: deribitBookChange.asks.map(this._mapBookLevel),
      timestamp: new Date(deribitBookChange.timestamp),
      localTimestamp: localTimestamp
    }
  }

  private _mapBookLevel(level: DeribitBookLevel) {
    const price = level[1]
    const amount = level[0] === 'delete' ? 0 : level[2]

    return { price, amount }
  }
}

type DeribitMessage = {
  params: {
    channel: string
  }
}

type DeribitTradesMessage = DeribitMessage & {
  params: {
    data: {
      trade_id: string
      instrument_name: string
      timestamp: number
      direction: 'buy' | 'sell'
      price: number
      amount: number
      trade_seq: number
    }[]
  }
}

type DeribitBookLevel = ['new' | 'change' | 'delete', number, number]

type DeribitBookMessage = DeribitMessage & {
  params: {
    data: {
      timestamp: number
      instrument_name: string
      prev_change_id?: number
      bids: DeribitBookLevel[]
      asks: DeribitBookLevel[]
    }
  }
}

type DeribitTickerMessage = DeribitMessage & {
  params: {
    data: {
      timestamp: number
      open_interest: number
      last_price: number
      mark_price: number
      instrument_name: string
      index_price: number
      current_funding?: number
      funding_8h?: number
    }
  }
}
