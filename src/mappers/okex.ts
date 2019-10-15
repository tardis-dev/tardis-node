import { DataType, DerivativeTicker, Trade, BookChange, FilterForExchange } from '../types'
import { MapperBase } from './mapper'

// https://www.okex.com/docs/en/#ws_swap-README

export class OkexMapper extends MapperBase {
  public supportedDataTypes = ['trade', 'book_change', 'derivative_ticker'] as const

  private readonly _dataTypeChannelMapping: { [key in DataType]: FilterForExchange['okex']['channel'][] } = {
    book_change: ['spot/depth', 'futures/depth', 'swap/depth'],
    trade: ['spot/trade', 'futures/trade', 'swap/trade'],
    derivative_ticker: ['spot/ticker', 'futures/ticker', 'swap/ticker', 'futures/mark_price', 'swap/mark_price', 'swap/funding_rate']
  }

  protected mapDataTypeAndSymbolsToFilters(dataType: DataType, symbols?: string[]): FilterForExchange['okex'][] {
    // depending if symbols is for spot/swap/futures it needs different underlying channel
    // for ticker symbol we also need data for funding_rate and mark_price when applicable

    if (symbols === undefined) {
      return this._dataTypeChannelMapping[dataType].map(channel => {
        return {
          channel
        }
      })
    }

    return symbols
      .map(symbol => {
        const isSwap = symbol.endsWith('-SWAP')
        const isFuture = symbol.match(/[0-9]$/)

        let prefix: string
        if (isSwap) {
          prefix = 'swap'
        } else if (isFuture) {
          prefix = 'futures'
        } else {
          prefix = 'spot'
        }

        return this._dataTypeChannelMapping[dataType]
          .filter(c => c.startsWith(prefix))
          .map(channel => {
            return {
              channel,
              symbols: [symbol]
            }
          })
      })
      .flatMap(c => c)
      .reduce(
        (prev, current) => {
          const matchingExisting = prev.find(c => c.channel === current.channel)
          if (matchingExisting !== undefined) {
            matchingExisting.symbols!.push(current.symbols[0])
          } else {
            prev.push(current)
          }

          return prev
        },
        [] as FilterForExchange['okex'][]
      )
  }
  protected detectDataType(message: OkexDataMessage): DataType | undefined {
    if (!message.table) {
      return
    }

    if (this._dataTypeChannelMapping.book_change.includes(message.table)) {
      return 'book_change'
    }

    if (this._dataTypeChannelMapping.trade.includes(message.table)) {
      return 'trade'
    }

    if (this._dataTypeChannelMapping.derivative_ticker.includes(message.table)) {
      return 'derivative_ticker'
    }

    return
  }

  protected *mapTrades(okexTradesMessage: OKexTradesDataMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const okexTrade of okexTradesMessage.data) {
      yield {
        type: 'trade',
        symbol: okexTrade.instrument_id,
        exchange: this.exchange,
        id: okexTrade.trade_id,
        price: Number(okexTrade.price),
        amount: Number(okexTrade.qty || okexTrade.size),
        side: okexTrade.side,
        timestamp: new Date(okexTrade.timestamp),
        localTimestamp: localTimestamp
      }
    }
  }

  protected *mapOrderBookChanges(okexDepthDataMessage: OkexDepthDataMessage, localTimestamp: Date): IterableIterator<BookChange> {
    for (const message of okexDepthDataMessage.data) {
      yield {
        type: 'book_change',
        symbol: message.instrument_id,
        exchange: this.exchange,
        isSnapshot: okexDepthDataMessage.action === 'partial',
        bids: message.bids.map(this._mapBookLevel),
        asks: message.asks.map(this._mapBookLevel),
        timestamp: new Date(message.timestamp),
        localTimestamp: localTimestamp
      }
    }
  }

  protected *mapDerivativeTickerInfo(
    message: OkexTickersMessage | OkexFundingRateMessage | OkexMarkPriceMessage,
    localTimestamp: Date
  ): IterableIterator<DerivativeTicker> {
    for (const okexMessage of message.data) {
      const pendingTickerInfo = this.getPendingTickerInfo(okexMessage.instrument_id)
      if ('funding_rate' in okexMessage) {
        pendingTickerInfo.updateFundingRate(Number(okexMessage.funding_rate))
      }

      if ('mark_price' in okexMessage) {
        pendingTickerInfo.updateMarkPrice(Number(okexMessage.mark_price))
      }
      if ('open_interest' in okexMessage) {
        pendingTickerInfo.updateOpenInterest(Number(okexMessage.open_interest))
      }
      if ('last' in okexMessage) {
        pendingTickerInfo.updateLastPrice(Number(okexMessage.last))
      }

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(
          okexMessage.timestamp !== undefined ? new Date(okexMessage.timestamp) : localTimestamp,
          localTimestamp
        )
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
    open_interest: string | undefined
    instrument_id: string
    timestamp: string
  }[]
}

type OkexFundingRateMessage = {
  data: {
    funding_rate: string
    instrument_id: string
    timestamp: undefined
  }[]
}

type OkexMarkPriceMessage = {
  data: {
    instrument_id: string
    mark_price: string
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
