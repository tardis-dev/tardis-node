import { Mapper, DataType, Trade, Quote, OrderBookL2Change, BookPriceLevel, Ticker } from './mapper'
import { FilterForExchange } from '../consts'

export class BitmexMapper implements Mapper<'bitmex'> {
  private readonly _idToPriceLevelMap: Map<number, number> = new Map()
  private readonly _instrumentsMap: Map<string, Required<BitmexInstrument>> = new Map()
  private readonly _dataTypeChannelMap: { [key in DataType]: FilterForExchange['bitmex']['channel'] } = {
    l2Change: 'orderBookL2',
    trade: 'trade',
    quote: 'quote',
    ticker: 'instrument'
  }

  getDataType(message: BitmexDataMessage): DataType | undefined {
    if (message.table == 'orderBookL2') {
      return 'l2Change'
    }

    // trades are insert only, let's skip partials as otherwise we'd end up with potential duplicates
    if (message.table == 'trade' && message.action == 'insert') {
      return 'trade'
    }

    // quotes are insert only, let's skip partials as otherwise we'd end up with potential duplicates
    if (message.table == 'quote' && message.action == 'insert') {
      return 'quote'
    }

    if (message.table == 'instrument') {
      return 'ticker'
    }

    return
  }

  getFiltersForDataTypeAndSymbols(dataType: DataType, symbols?: string[]) {
    return [
      {
        channel: this._dataTypeChannelMap[dataType],
        symbols
      }
    ]
  }

  *mapTrades(bitmexTradesMessage: BitmexTradesMessage, localTimestamp?: Date): IterableIterator<Trade> {
    for (const bitmexTrade of bitmexTradesMessage.data) {
      yield {
        id: bitmexTrade.trdMatchID,
        symbol: bitmexTrade.symbol,
        price: bitmexTrade.price,
        amount: bitmexTrade.size,
        side: bitmexTrade.side == BitmexSide.Buy ? 'buy' : 'sell',
        timestamp: new Date(bitmexTrade.timestamp),
        localTimestamp
      }
    }
  }

  *mapQuotes(bitmexQuotesMessage: BitmexQuotesMessage, localTimestamp?: Date): IterableIterator<Quote> {
    for (const bitmexQuote of bitmexQuotesMessage.data) {
      yield {
        symbol: bitmexQuote.symbol,
        bestBidPrice: bitmexQuote.bidPrice,
        bestBidAmount: bitmexQuote.bidSize,
        bestAskPrice: bitmexQuote.askPrice,
        bestAskAmount: bitmexQuote.askSize,
        timestamp: new Date(bitmexQuote.timestamp),
        localTimestamp
      }
    }
  }

  *mapOrderBookL2Changes(bitmexOrderBookL2Message: BitmexOrderBookL2Message, localTimestamp: Date): IterableIterator<OrderBookL2Change> {
    let bitmexBookMessagesGrouppedBySymbol
    // only partial messages can contain different symbols (when subscribed via {"op": "subscribe", "args": ["orderBookL2"]} for example)
    if (bitmexOrderBookL2Message.action == 'partial') {
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

      for (const item of bitmexOrderBookL2Message.data) {
        if (item.price != undefined) {
          // store the mapping from id to price level if price is specified
          this._idToPriceLevelMap.set(item.id, item.price)
        }
        const price = this._idToPriceLevelMap.get(item.id)
        const amount = item.size || 0 // delete messages do not contain size specified
        // if we still don't have a price it means that there was an update before partial message - let's skip it
        if (price === undefined) {
          continue
        }

        if (item.side == BitmexSide.Buy) {
          bids.push({ price, amount })
        } else {
          asks.push({ price, amount })
        }
      }

      const bookChange: OrderBookL2Change = {
        symbol,
        bids,
        asks,
        localTimestamp
      }

      yield bookChange
    }
  }

  *mapTickers(bitmexInstrumentsMessage: BitmexInstrumentsMessage, localTimestamp?: Date): IterableIterator<Ticker> {
    for (const bitmexInstrument of bitmexInstrumentsMessage.data) {
      // unfortunately bitmex doesn't provide each instrument change as new 'insert' with full data, hence we need to cache initial
      // inserts and apply updates locally
      let bitmexCompleteInstrument

      const shouldUpdateInstrumentsMap = bitmexInstrumentsMessage.action == 'partial' || bitmexInstrumentsMessage.action == 'insert'
      if (shouldUpdateInstrumentsMap) {
        bitmexCompleteInstrument = bitmexInstrument as Required<BitmexInstrument>
        this._instrumentsMap.set(bitmexInstrument.symbol, bitmexCompleteInstrument)
      } else {
        // skip message if we've received update before partial
        const matching = this._instrumentsMap.get(bitmexInstrument.symbol)
        if (!matching) {
          continue
        }
        // apply updates to stored 'ticker' and store in local cache map
        bitmexCompleteInstrument = { ...matching, ...bitmexInstrument }
        this._instrumentsMap.set(bitmexInstrument.symbol, bitmexCompleteInstrument)
      }

      yield {
        symbol: bitmexCompleteInstrument.symbol,
        bestBidPrice: bitmexCompleteInstrument.bidPrice,
        bestAskPrice: bitmexCompleteInstrument.askPrice,
        lastPrice: bitmexCompleteInstrument.lastPrice,
        volume: bitmexCompleteInstrument.volume24h,

        openInterest: bitmexCompleteInstrument.openInterest,
        fundingRate: bitmexCompleteInstrument.fundingRate,
        indexPrice: bitmexCompleteInstrument.indicativeSettlePrice,
        markPrice: bitmexCompleteInstrument.markPrice,

        timestamp: new Date(bitmexCompleteInstrument.timestamp),
        localTimestamp
      }
    }
  }
}

type BitmexDataMessage = {
  table: FilterForExchange['bitmex']['channel']
  action: 'partial' | 'update' | 'insert' | 'delete'
}

const enum BitmexSide {
  Buy = 'Buy',
  Sell = 'Sell'
}

type BitmexTradesMessage = BitmexDataMessage & {
  table: 'trade'
  action: 'insert'
  data: { symbol: string; trdMatchID: string; side: BitmexSide; size: number; price: number; timestamp: string }[]
}

type BitmexQuotesMessage = BitmexDataMessage & {
  table: 'quote'
  action: 'insert'
  data: { timestamp: string; symbol: string; bidSize: number; bidPrice: number; askPrice: number; askSize: number }[]
}

type BitmexInstrument = {
  symbol: string
  bidPrice?: number
  askPrice?: number
  lastPrice?: number
  volume24h?: number
  openInterest?: number
  fundingRate?: number
  markPrice?: number
  indicativeSettlePrice?: number
  timestamp: string
}

type BitmexInstrumentsMessage = BitmexDataMessage & {
  table: 'instrument'
  data: BitmexInstrument[]
}

type BitmexOrderBookL2Message = BitmexDataMessage & {
  table: 'orderBookL2'
  data: { symbol: string; id: number; side: BitmexSide; size?: number; price?: number }[]
}

type Required<T> = {
  [P in keyof T]-?: T[P]
}
