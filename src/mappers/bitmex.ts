import { BookChange, BookPriceLevel, DerivativeTicker, FilterForExchange, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://www.bitmex.com/app/wsAPI

export const bitmexTradesMapper: Mapper<'bitmex', Trade> = {
  canHandle(message: BitmexDataMessage) {
    return message.table === 'trade' && message.action === 'insert'
  },

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'trade',
        symbols
      }
    ]
  },

  *map(bitmexTradesMessage: BitmexTradesMessage, localTimestamp: Date) {
    for (const bitmexTrade of bitmexTradesMessage.data) {
      yield {
        type: 'trade',
        symbol: bitmexTrade.symbol,
        exchange: 'bitmex',
        id: bitmexTrade.trdMatchID,
        price: bitmexTrade.price,
        amount: bitmexTrade.size,
        side: bitmexTrade.side !== undefined ? (bitmexTrade.side === 'Buy' ? 'buy' : 'sell') : 'unknown',
        timestamp: new Date(bitmexTrade.timestamp),
        localTimestamp: localTimestamp
      }
    }
  }
}

export class BitmexBookChangeMapper implements Mapper<'bitmex', BookChange> {
  private readonly _idToPriceLevelMap: Map<
    number,
    {
      price: number
      side: 'Buy' | 'Sell'
    }
  > = new Map()

  canHandle(message: BitmexDataMessage) {
    return message.table === 'orderBookL2'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'orderBookL2',
        symbols
      } as const
    ]
  }

  *map(bitmexOrderBookL2Message: BitmexOrderBookL2Message, localTimestamp: Date): IterableIterator<BookChange> {
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
        let levelMeta = this._idToPriceLevelMap.get(item.id)

        // There are cases when bitmex can publish:
        // a) update for a given level that has also changed side, for example it was a bid now it's an ask but we've got single message (instead of two: insert to asks and delete from bids)
        // b) insert message to add new level but such level already exists but on the other side of the order book, but still there was no delete message for the other side of the book
        // We need to detect such cases and in addition to normal processing also remove the level from the opposite side
        let levelSwitchedSides = levelMeta !== undefined && levelMeta.side !== item.side

        if (item.price !== undefined || levelSwitchedSides) {
          // as long as price or side has changed we need to update our local meta info
          const metaToCache = {
            price: item.price !== undefined ? item.price : levelMeta!.price,
            side: item.side
          }

          this._idToPriceLevelMap.set(item.id, metaToCache)
          levelMeta = metaToCache
        }

        // if we still don't have a meta info it means that there was an update before partial message - let's skip it
        if (levelMeta === undefined) {
          continue
        }

        const amount = item.size || 0 // delete messages do not contain size field

        const { price } = levelMeta

        // construct book change according to provided item side
        if (item.side === 'Buy') {
          bids.push({ price, amount })
        } else {
          asks.push({ price, amount })
        }

        // as long as item side has changed we need to remove such level from the opposite side
        if (levelSwitchedSides) {
          if (item.side === 'Buy') {
            asks.push({ price, amount: 0 })
          } else {
            bids.push({ price, amount: 0 })
          }
        }

        // remove meta info for deleted level
        if (bitmexOrderBookL2Message.action === 'delete') {
          this._idToPriceLevelMap.delete(item.id)
        }
      }

      if (bids.length > 0 || asks.length > 0) {
        const bookChange: BookChange = {
          type: 'book_change',
          symbol,
          exchange: 'bitmex',
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
}

export class BitmexDerivativeTickerMapper implements Mapper<'bitmex', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: BitmexDataMessage) {
    return message.table === 'instrument'
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'instrument',
        symbols
      } as const
    ]
  }

  *map(message: BitmexInstrumentsMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    for (const bitmexInstrument of message.data) {
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(bitmexInstrument.symbol, 'bitmex')

      pendingTickerInfo.updateFundingRate(bitmexInstrument.fundingRate)
      pendingTickerInfo.updatePredictedFundingRate(bitmexInstrument.indicativeFundingRate)
      pendingTickerInfo.updateFundingTimestamp(bitmexInstrument.fundingTimestamp ? new Date(bitmexInstrument.fundingTimestamp) : undefined)
      pendingTickerInfo.updateIndexPrice(bitmexInstrument.indicativeSettlePrice)
      pendingTickerInfo.updateMarkPrice(bitmexInstrument.markPrice)
      pendingTickerInfo.updateOpenInterest(bitmexInstrument.openInterest)
      pendingTickerInfo.updateLastPrice(bitmexInstrument.lastPrice)

      if (bitmexInstrument.timestamp !== undefined) {
        pendingTickerInfo.updateTimestamp(new Date(bitmexInstrument.timestamp))
      }

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
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
  indicativeFundingRate?: number | null
  fundingTimestamp?: string | null
  timestamp?: string
}

type BitmexInstrumentsMessage = BitmexDataMessage & {
  table: 'instrument'
  data: BitmexInstrument[]
}

type BitmexOrderBookL2Message = BitmexDataMessage & {
  table: 'orderBookL2'
  data: { symbol: string; id: number; side: 'Buy' | 'Sell'; size?: number; price?: number }[]
}
