import { asNumberIfValid, upperCaseSymbols } from '../handy'
import { BookChange, BookPriceLevel, BookTicker, DerivativeTicker, FilterForExchange, Liquidation, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://www.bitmex.com/app/wsAPI

export const bitmexTradesMapper: Mapper<'bitmex', Trade> = {
  canHandle(message: BitmexDataMessage) {
    return message.table === 'trade' && message.action === 'insert'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trade',
        symbols
      }
    ]
  },

  *map(bitmexTradesMessage: BitmexTradesMessage, localTimestamp: Date) {
    for (const bitmexTrade of bitmexTradesMessage.data) {
      const trade: Trade = {
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

      yield trade
    }
  }
}

export class BitmexBookChangeMapper implements Mapper<'bitmex', BookChange> {
  private readonly _idToPriceLevelMap: Map<number, number> = new Map()

  canHandle(message: BitmexDataMessage) {
    return message.table === 'orderBookL2'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

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

      if (bitmexOrderBookL2Message.data.length === 0 && bitmexOrderBookL2Message.filter?.symbol !== undefined) {
        const emptySnapshot: BookChange = {
          type: 'book_change',
          symbol: bitmexOrderBookL2Message.filter?.symbol!,
          exchange: 'bitmex',
          isSnapshot: true,
          bids: [],
          asks: [],
          timestamp: localTimestamp,
          localTimestamp: localTimestamp
        }

        yield emptySnapshot
      }
    } else {
      // in case of other messages types BitMEX always returns data for single symbol
      bitmexBookMessagesGrouppedBySymbol = {
        [bitmexOrderBookL2Message.data[0].symbol]: bitmexOrderBookL2Message.data
      }
    }

    for (let symbol in bitmexBookMessagesGrouppedBySymbol) {
      const bids: BookPriceLevel[] = []
      const asks: BookPriceLevel[] = []
      let latestBitmexTimestamp: Date | undefined = undefined

      for (const item of bitmexBookMessagesGrouppedBySymbol[symbol]) {
        if (item.timestamp !== undefined) {
          const priceLevelTimestamp = new Date(item.timestamp)
          if (latestBitmexTimestamp === undefined) {
            latestBitmexTimestamp = priceLevelTimestamp
          } else {
            if (priceLevelTimestamp.valueOf() > latestBitmexTimestamp.valueOf()) {
              latestBitmexTimestamp = priceLevelTimestamp
            }
          }
        }

        // https://www.bitmex.com/app/restAPI#OrderBookL2
        if (item.price !== undefined) {
          // store the mapping from id to price level if price is specified
          // only partials and inserts have price set
          this._idToPriceLevelMap.set(item.id, item.price)
        }
        const price = this._idToPriceLevelMap.get(item.id)
        const amount = item.size || 0 // delete messages do not have size specified
        // if we still don't have a price it means that there was an update before partial message - let's skip it
        if (price === undefined) {
          continue
        }

        if (item.side === 'Buy') {
          bids.push({ price, amount })
        } else {
          asks.push({ price, amount })
        }
        // remove meta info for deleted level
        if (bitmexOrderBookL2Message.action === 'delete') {
          this._idToPriceLevelMap.delete(item.id)
        }
      }

      const isSnapshot = bitmexOrderBookL2Message.action === 'partial'

      if (bids.length > 0 || asks.length > 0 || isSnapshot) {
        const bookChange: BookChange = {
          type: 'book_change',
          symbol,
          exchange: 'bitmex',
          isSnapshot,
          bids,
          asks,
          timestamp: latestBitmexTimestamp !== undefined ? latestBitmexTimestamp : localTimestamp,
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
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'instrument',
        symbols
      } as const
    ]
  }

  *map(message: BitmexInstrumentsMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    for (const bitmexInstrument of message.data) {
      // process instrument messages only if:
      // - we already have seen their 'partials' or already have 'pending info'
      // - and instruments aren't settled or unlisted already
      const isOpen = bitmexInstrument.state === undefined || bitmexInstrument.state === 'Open' || bitmexInstrument.state === 'Closed'
      const isPartial = message.action === 'partial'
      const hasPendingInfo = this.pendingTickerInfoHelper.hasPendingTickerInfo(bitmexInstrument.symbol)

      if ((isPartial || hasPendingInfo) && isOpen) {
        const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(bitmexInstrument.symbol, 'bitmex')

        pendingTickerInfo.updateFundingRate(bitmexInstrument.fundingRate)
        pendingTickerInfo.updatePredictedFundingRate(bitmexInstrument.indicativeFundingRate)
        pendingTickerInfo.updateFundingTimestamp(
          bitmexInstrument.fundingTimestamp ? new Date(bitmexInstrument.fundingTimestamp) : undefined
        )
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
}

export const bitmexLiquidationsMapper: Mapper<'bitmex', Liquidation> = {
  canHandle(message: BitmexDataMessage) {
    return message.table === 'liquidation' && message.action === 'insert'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'liquidation',
        symbols
      }
    ]
  },

  *map(bitmexLiquiationsMessage: BitmexLiquidation, localTimestamp: Date) {
    for (const bitmexLiquidation of bitmexLiquiationsMessage.data) {
      const liquidation: Liquidation = {
        type: 'liquidation',
        symbol: bitmexLiquidation.symbol,
        exchange: 'bitmex',
        id: bitmexLiquidation.orderID,
        price: bitmexLiquidation.price,
        amount: bitmexLiquidation.leavesQty,
        side: bitmexLiquidation.side === 'Buy' ? 'buy' : 'sell',
        timestamp: localTimestamp,
        localTimestamp: localTimestamp
      }

      yield liquidation
    }
  }
}

export const bitmexBookTickerMapper: Mapper<'bitmex', BookTicker> = {
  canHandle(message: BitmexDataMessage) {
    return message.table === 'quote' && message.action === 'insert'
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'quote',
        symbols
      }
    ]
  },

  *map(bitmexQuoteMessage: BitmexQuote, localTimestamp: Date) {
    for (const bitmexQuote of bitmexQuoteMessage.data) {
      const ticker: BookTicker = {
        type: 'book_ticker',
        symbol: bitmexQuote.symbol,
        exchange: 'bitmex',
        askAmount: asNumberIfValid(bitmexQuote.askSize),
        askPrice: asNumberIfValid(bitmexQuote.askPrice),

        bidPrice: asNumberIfValid(bitmexQuote.bidPrice),
        bidAmount: asNumberIfValid(bitmexQuote.bidSize),
        timestamp: new Date(bitmexQuote.timestamp),
        localTimestamp: localTimestamp
      }

      yield ticker
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
  data: {
    symbol: string
    trdMatchID: string
    side?: 'Buy' | 'Sell'
    size: number
    price: number
    timestamp: string
  }[]
}

type BitmexInstrument = {
  symbol: string
  state?: 'Open' | 'Closed' | 'Unlisted' | 'Settled'
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
  filter?: { symbol?: string }
  data: {
    symbol: string
    id: number
    side: 'Buy' | 'Sell'
    size?: number
    price?: number
    timestamp?: string
  }[]
}

type BitmexLiquidation = BitmexDataMessage & {
  table: 'liquidation'
  data: {
    orderID: string
    symbol: string
    side: 'Buy' | 'Sell'
    price: number
    leavesQty: number
  }[]
}

type BitmexQuote = BitmexDataMessage & {
  table: 'quote'
  action: 'insert'
  data: [{ timestamp: string; symbol: string; bidSize: number; bidPrice: number; askPrice: number; askSize: number }]
}
