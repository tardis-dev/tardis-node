import { DataType, DerivativeTicker, Trade, BookChange, FilterForExchange, BookPriceLevel } from '../types'
import { MapperBase } from './mapper'

// https://www.bitmex.com/app/wsAPI

export class BitmexMapper extends MapperBase {
  public supportedDataTypes = ['trade', 'book_change', 'derivative_ticker'] as const

  private readonly _idToPriceLevelMap: Map<number, number> = new Map()

  private readonly _dataTypeChannelMapping: { [key in DataType]: FilterForExchange['bitmex']['channel'] } = {
    book_change: 'orderBookL2',
    trade: 'trade',
    derivative_ticker: 'instrument'
  }

  protected mapDataTypeAndSymbolsToFilters(dataType: DataType, symbols?: string[]) {
    return [
      {
        channel: this._dataTypeChannelMapping[dataType],
        symbols
      }
    ]
  }

  protected detectDataType(message: BitmexDataMessage): DataType | undefined {
    if (message.table === undefined) {
      return
    }

    if (message.table === this._dataTypeChannelMapping.book_change) {
      return 'book_change'
    }

    // trades are insert only, let's skip partials as otherwise we'd end up with potential duplicates
    if (message.table === this._dataTypeChannelMapping.trade && message.action === 'insert') {
      return 'trade'
    }

    if (message.table === this._dataTypeChannelMapping.derivative_ticker) {
      return 'derivative_ticker'
    }

    return
  }

  protected *mapTrades(bitmexTradesMessage: BitmexTradesMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const bitmexTrade of bitmexTradesMessage.data) {
      yield {
        type: 'trade',
        symbol: bitmexTrade.symbol,
        id: bitmexTrade.trdMatchID,
        price: bitmexTrade.price,
        amount: bitmexTrade.size,
        side: bitmexTrade.side !== undefined ? (bitmexTrade.side === 'Buy' ? 'buy' : 'sell') : 'unknown',
        timestamp: new Date(bitmexTrade.timestamp),
        localTimestamp: localTimestamp
      }
    }
  }

  protected *mapOrderBookChanges(bitmexOrderBookL2Message: BitmexOrderBookL2Message, localTimestamp: Date): IterableIterator<BookChange> {
    let bitmexBookMessagesGrouppedBySymbol
    // only partial messages can contain different symbols (when subscribed via {"op": "subscribe", "args": ["orderBookL2"]} for example)
    if (bitmexOrderBookL2Message.action === 'partial') {
      bitmexBookMessagesGrouppedBySymbol = bitmexOrderBookL2Message.data.reduce(
        (prev, current) => {
          if (prev[current.symbol]) {
            prev[current.symbol].push(current)
          } else {
            prev[current.symbol] = [current]
          }

          return prev
        },
        {} as {
          [key: string]: typeof bitmexOrderBookL2Message.data
        }
      )
    } else {
      // in case of other messages types BitMEX always returns data for single symbol
      bitmexBookMessagesGrouppedBySymbol = {
        [bitmexOrderBookL2Message.data[0].symbol]: bitmexOrderBookL2Message.data
      }
    }

    for (let symbol in bitmexBookMessagesGrouppedBySymbol) {
      const bids: BookPriceLevel[] = []
      const asks: BookPriceLevel[] = []

      for (const item of bitmexBookMessagesGrouppedBySymbol[symbol]) {
        // https://www.bitmex.com/app/restAPI#OrderBookL2
        if (item.price !== undefined) {
          // store the mapping from id to price level if price is specified
          this._idToPriceLevelMap.set(item.id, item.price)
        }
        const price = this._idToPriceLevelMap.get(item.id)
        const amount = item.size || 0 // delete messages do not contain size specified
        // if we still don't have a price it means that there was an update before partial message - let's skip it
        if (price === undefined) {
          continue
        }

        if (item.side === 'Buy') {
          bids.push({ price, amount })
        } else {
          asks.push({ price, amount })
        }
      }

      if (bids.length > 0 || asks.length > 0) {
        const bookChange: BookChange = {
          type: 'book_change',
          symbol,
          isSnapshot: bitmexOrderBookL2Message.action === 'partial',
          bids,
          asks,
          timestamp: localTimestamp,
          localTimestamp: localTimestamp
        }

        yield bookChange
      }
    }
  }

  protected *mapDerivativeTickerInfo(message: BitmexInstrumentsMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    for (const bitmexInstrument of message.data) {
      const pendingTickerInfo = this.getPendingTickerInfo(bitmexInstrument.symbol)

      pendingTickerInfo.updateFundingRate(bitmexInstrument.fundingRate)
      pendingTickerInfo.updateIndexPrice(bitmexInstrument.indicativeSettlePrice)
      pendingTickerInfo.updateMarkPrice(bitmexInstrument.markPrice)
      pendingTickerInfo.updateOpenInterest(bitmexInstrument.openInterest)
      pendingTickerInfo.updateLastPrice(bitmexInstrument.lastPrice)

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(new Date(bitmexInstrument.timestamp), localTimestamp)
      }
    }
  }
}

type BitmexDataMessage = {
  table: FilterForExchange['bitmex']['channel']
  action: 'partial' | 'update' | 'insert' | 'delete'
}

type BitmexTradesMessage = BitmexDataMessage & {
  table: 'trade'
  action: 'insert'
  data: { symbol: string; trdMatchID: string; side?: 'Buy' | 'Sell'; size: number; price: number; timestamp: string }[]
}

type BitmexInstrument = {
  symbol: string
  openInterest?: number | null
  fundingRate?: number | null
  markPrice?: number | null
  lastPrice?: number | null
  indicativeSettlePrice?: number | null
  timestamp: string
}

type BitmexInstrumentsMessage = BitmexDataMessage & {
  table: 'instrument'
  data: BitmexInstrument[]
}

type BitmexOrderBookL2Message = BitmexDataMessage & {
  table: 'orderBookL2'
  data: { symbol: string; id: number; side: 'Buy' | 'Sell'; size?: number; price?: number }[]
}
