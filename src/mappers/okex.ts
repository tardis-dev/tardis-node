import { Mapper, DataType, L2Change, Quote, Trade, Ticker } from './mapper'
import { FilterForExchange } from '../consts'

export class OkexMapper extends Mapper<'okex'> {
  private readonly _dataTypeChannelSuffixMap: { [key in DataType]?: string } = {
    l2change: 'depth',
    trade: 'trade',
    ticker: 'ticker'
  }

  public getFiltersForDataTypeAndSymbols(dataType: DataType, symbols?: string[]): FilterForExchange['okex'][] {
    if (dataType == 'quote') {
      throw new Error('OKEx does not support normalized quote data')
    }
    const prefixes = ['spot', 'swap', 'futures']
    const suffix = this._dataTypeChannelSuffixMap[dataType]!
    if (!symbols) {
      return prefixes.map(
        p =>
          ({
            channel: `${p}/${suffix}`
          } as any)
      )
    }

    return symbols.map(symbol => {
      const isSwap = symbol.endsWith('-SWAP')
      const isFuture = symbol.match(/[0-9]$/)
      let prefix
      if (isSwap) {
        prefix = 'swap'
      } else if (isFuture) {
        prefix = 'futures'
      } else {
        prefix = 'spot'
      }

      return {
        channel: `${prefix}/${suffix}`,
        symbols: [symbol]
      } as FilterForExchange['okex']
    })
  }

  protected getDataType(message: OkexDataMessage): DataType | undefined {
    if (!message.table) {
      return
    }

    if (message.table.endsWith('depth')) {
      return 'l2change'
    }

    if (message.table.endsWith('trade')) {
      return 'trade'
    }

    if (message.table.endsWith('ticker')) {
      return 'ticker'
    }
    return
  }

  protected *mapTrades(okexTradesMessage: OKexTradesDataMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const okexTrade of okexTradesMessage.data) {
      yield {
        type: 'trade',
        id: okexTrade.trade_id,
        symbol: okexTrade.instrument_id,
        price: Number(okexTrade.price),
        amount: Number(okexTrade.qty || okexTrade.size),
        side: okexTrade.side,
        timestamp: new Date(okexTrade.timestamp),
        localTimestamp
      }
    }
  }

  protected mapQuotes(): IterableIterator<Quote> {
    throw new Error('OKEx does not support normalized quote data')
  }

  protected *mapL2OrderBookChanges(okexDepthDataMessage: OkexDepthDataMessage, localTimestamp: Date): IterableIterator<L2Change> {
    for (const message of okexDepthDataMessage.data) {
      yield {
        type: 'l2change',
        symbol: message.instrument_id,
        bids: message.bids.map(this._mapBookLevel),
        asks: message.asks.map(this._mapBookLevel),
        timestamp: new Date(message.timestamp),
        localTimestamp
      }
    }
  }

  protected *mapTickers(okexTickersMessage: OkexTickersMessage, localTimestamp: Date): IterableIterator<Ticker> {
    for (const okexTicker of okexTickersMessage.data) {
      yield {
        type: 'ticker',
        symbol: okexTicker.instrument_id,
        bestBidPrice: Number(okexTicker.best_bid),
        bestAskPrice: Number(okexTicker.best_ask),
        lastPrice: Number(okexTicker.last),
        timestamp: new Date(okexTicker.timestamp),
        localTimestamp
      }
    }
  }

  private _mapBookLevel(level: OkexBookLevel) {
    const price = Number(level[0])
    const amount = Number(level[1])

    return { price, amount }
  }
}

type OkexDataMessage = {
  table: FilterForExchange['okex']['channel']
}

type OKexTradesDataMessage = {
  data: {
    side: 'buy' | 'sell'
    trade_id: string
    price: string | number
    qty?: string | number
    size?: string | number
    instrument_id: string
    timestamp: string
  }[]
}

type OkexTickersMessage = {
  data: {
    last: string | number
    best_bid: string | number
    best_ask: string | number
    instrument_id: string
    timestamp: string
  }[]
}

type OkexDepthDataMessage = {
  action: 'partial' | 'update'
  data: {
    instrument_id: string
    asks: OkexBookLevel[]
    bids: OkexBookLevel[]
    timestamp: string
  }[]
}

type OkexBookLevel = [number | string, number | string, number | string, number | string]
