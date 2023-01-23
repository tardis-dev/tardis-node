import { upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, DerivativeTicker, Exchange, FilterForExchange, Liquidation, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

export const wooxTradesMapper: Mapper<'woo-x', Trade> = {
  canHandle(message: WooxTradeMessage) {
    return message.topic !== undefined && message.topic.endsWith('@trade')
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

  *map(message: WooxTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    const timestamp = new Date(message.ts)

    yield {
      type: 'trade',
      symbol: message.data.symbol,
      exchange: 'woo-x',
      id: undefined,
      price: message.data.price,
      amount: message.data.size,
      side: message.data.side === 'SELL' ? 'sell' : 'buy',
      timestamp,
      localTimestamp: localTimestamp
    }
  }
}

export class WooxBookChangeMapper implements Mapper<'woo-x', BookChange> {
  private readonly _symbolToDepthInfoMapping: { [key: string]: LocalDepthInfo } = {}

  canHandle(message: WooxOrderbookMessage | WooxOrderbookupdateMessage) {
    if ('id' in message) {
      return message.id.endsWith('@orderbook')
    }

    if ('topic' in message) {
      return message.topic.endsWith('@orderbookupdate')
    }

    return false
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'orderbook',
        symbols
      },
      {
        channel: 'orderbookupdate',
        symbols
      }
    ]
  }

  *map(message: WooxOrderbookMessage | WooxOrderbookupdateMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const symbol = message.data.symbol

    if (this._symbolToDepthInfoMapping[symbol] === undefined) {
      this._symbolToDepthInfoMapping[symbol] = {
        bufferedUpdates: []
      }
    }

    const symbolDepthInfo = this._symbolToDepthInfoMapping[symbol]
    const snapshotAlreadyProcessed = symbolDepthInfo.snapshotProcessed

    // first check if received message is snapshot and process it as such if it is
    if ('id' in message && message.success) {
      yield {
        type: 'book_change',
        symbol,
        exchange: 'woo-x',
        isSnapshot: true,
        bids: message.data.bids.map(this._mapBookLevel),
        asks: message.data.asks.map(this._mapBookLevel),
        timestamp: new Date(message.data.ts),
        localTimestamp
      }

      //  mark given symbol depth info that has snapshot processed
      symbolDepthInfo.lastUpdateTimestamp = message.data.ts
      symbolDepthInfo.snapshotProcessed = true

      // if there were any depth updates buffered, let's proccess those
      for (const update of symbolDepthInfo.bufferedUpdates) {
        const bookChange = this._mapBookDepthUpdate(update, localTimestamp, symbolDepthInfo, symbol)
        if (bookChange !== undefined) {
          yield bookChange
        }
      }
      // remove all buffered updates
      symbolDepthInfo.bufferedUpdates = []
    } else if (snapshotAlreadyProcessed) {
      // snapshot was already processed let's map the message as normal book_change
      const bookChange = this._mapBookDepthUpdate(message as WooxOrderbookupdateMessage, localTimestamp, symbolDepthInfo, symbol)
      if (bookChange !== undefined) {
        yield bookChange
      }
    } else {
      // if snapshot hasn't been yet processed and we've got depthUpdate message, let's buffer it for later processing
      symbolDepthInfo.bufferedUpdates.push(message as WooxOrderbookupdateMessage)
    }
  }

  private _mapBookDepthUpdate(
    wooxBookUpdate: WooxOrderbookupdateMessage,
    localTimestamp: Date,
    depthInfo: LocalDepthInfo,
    symbol: string
  ): BookChange | undefined {
    if (wooxBookUpdate.data.prevTs < depthInfo.lastUpdateTimestamp!) {
      return
    }

    return {
      type: 'book_change',
      symbol,
      exchange: 'woo-x',
      isSnapshot: false,
      bids: wooxBookUpdate.data.bids.map(this._mapBookLevel),
      asks: wooxBookUpdate.data.asks.map(this._mapBookLevel),
      timestamp: new Date(wooxBookUpdate.ts),
      localTimestamp
    }
  }

  private _mapBookLevel(level: [number, number]) {
    const price = level[0]
    const amount = level[1]

    return { price, amount }
  }
}

export class WooxDerivativeTickerMapper implements Mapper<'woo-x', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()
  private readonly _indexPrices = new Map<string, number>()

  canHandle(message: WooxTradeMessage | WooxEstFundingRate | WooxMarkPrice | WooxIndexPrice | WooxOpenInterest) {
    if (message.topic === undefined) {
      return false
    }
    const symbol = (message.data && message.data.symbol) || ''
    const isPerp = symbol.startsWith('PERP_')

    return (
      (message.topic.endsWith('@trade') && isPerp) ||
      (message.topic.endsWith('@markprice') && isPerp) ||
      (message.topic.endsWith('@estfundingrate') && isPerp) ||
      message.topic.endsWith('@indexprice') ||
      (message.topic.endsWith('@openinterest') && isPerp)
    )
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    const spotSymbols = symbols !== undefined ? symbols.map((s) => s.replace('PERP_', 'SPOT_')) : []
    return [
      {
        channel: 'trade',
        symbols
      },
      {
        channel: 'markprice',
        symbols
      },
      {
        channel: 'estfundingrate',
        symbols
      },
      {
        channel: 'openinterest',
        symbols
      },
      {
        channel: 'indexprice',
        symbols: spotSymbols
      }
    ]
  }

  *map(message: any, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    if (message.topic.endsWith('@indexprice')) {
      this._indexPrices.set(message.data.symbol.replace('SPOT_', 'PERP_'), message.data.price)
    } else {
      const symbol = message.data.symbol
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(symbol, 'woo-x')

      const lastIndexPrice = this._indexPrices.get(symbol)
      if (lastIndexPrice !== undefined) {
        pendingTickerInfo.updateIndexPrice(lastIndexPrice)
      }

      if (message.topic.endsWith('@markprice')) {
        pendingTickerInfo.updateMarkPrice(message.data.price)
        pendingTickerInfo.updateTimestamp(new Date(message.ts))
      }

      if (message.topic.endsWith('@trade')) {
        pendingTickerInfo.updateLastPrice(message.data.price)
        pendingTickerInfo.updateTimestamp(new Date(message.ts))
      }

      if (message.topic.endsWith('@estfundingrate')) {
        pendingTickerInfo.updateFundingRate(message.data.fundingRate)
        pendingTickerInfo.updateFundingTimestamp(new Date(message.data.fundingTs))
        pendingTickerInfo.updateTimestamp(new Date(message.ts))
      }

      if (message.topic.endsWith('@openinterest')) {
        pendingTickerInfo.updateOpenInterest(message.data.openInterest)
        pendingTickerInfo.updateTimestamp(new Date(message.ts))
      }

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

export class WooxBookTickerMapper implements Mapper<'woo-x', BookTicker> {
  canHandle(message: WooxTradeMessage) {
    return message.topic !== undefined && message.topic.endsWith('@bbo')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'bbo',
        symbols
      }
    ]
  }

  *map(wooxBBOMessage: WooxBBOMessage, localTimestamp: Date) {
    const wooxBookTicker = wooxBBOMessage.data

    const ticker: BookTicker = {
      type: 'book_ticker',
      symbol: wooxBookTicker.symbol,
      exchange: 'woo-x',
      askAmount: wooxBookTicker.askSize !== undefined ? wooxBookTicker.askSize : undefined,
      askPrice: wooxBookTicker.ask !== undefined ? wooxBookTicker.ask : undefined,

      bidPrice: wooxBookTicker.bid !== undefined ? wooxBookTicker.bid : undefined,
      bidAmount: wooxBookTicker.bidSize !== undefined ? wooxBookTicker.bidSize : undefined,
      timestamp: new Date(wooxBBOMessage.ts),
      localTimestamp: localTimestamp
    }

    yield ticker
  }
}

type LocalDepthInfo = {
  bufferedUpdates: WooxOrderbookupdateMessage[]
  snapshotProcessed?: boolean
  lastUpdateTimestamp?: number
}

type WooxTradeMessage = {
  topic: 'PERP_GALA_USDT@trade'
  ts: 1674431999995
  data: { symbol: 'PERP_GALA_USDT'; price: 0.048756; size: 4109; side: 'SELL'; source: 0 }
}

type WooxOrderbookupdateMessage = {
  topic: 'PERP_BTC_USDT@orderbookupdate'
  ts: 1674432000020
  data: {
    symbol: 'PERP_BTC_USDT'
    prevTs: 1674432000030
    asks: [[22712.7, 15.4675]]
    bids: [[22708.0, 4.503]]
  }
}

type WooxOrderbookMessage = {
  id: 'PERP_BTC_USDT@orderbook'
  event: 'request'
  success: true
  ts: 1674432000034
  data: {
    symbol: 'PERP_BTC_USDT'
    ts: 1674432000020
    asks: [[22712.7, 15.4675], [26772.1, 0.248]]
    bids: [[22708.0, 4.503], [18555.0, 0.002]]
  }
}

type WooxBBOMessage = {
  topic: 'SPOT_ETH_USDT@bbo'
  ts: 1674431999996
  data: { symbol: 'SPOT_ETH_USDT'; ask: 1627.61; askSize: 38.3755; bid: 1627.26; bidSize: 20.424926 }
}

type WooxMarkPrice = { topic: 'PERP_BTC_USDT@markprice'; ts: 1674432000007; data: { symbol: 'PERP_BTC_USDT'; price: 22711.11 } }

type WooxEstFundingRate = {
  topic: 'PERP_BTC_USDT@estfundingrate'
  ts: 1674432059002
  data: { symbol: 'PERP_BTC_USDT'; fundingRate: 0.00000782; fundingTs: 1674435600005 }
}

type WooxIndexPrice = { topic: 'SPOT_BTC_USDT@indexprice'; ts: 1674432000024; data: { symbol: 'SPOT_BTC_USDT'; price: 22708.44 } }
type WooxOpenInterest = { topic: 'PERP_BTC_USDT@openinterest'; ts: 1674432013624; data: { symbol: 'PERP_BTC_USDT'; openInterest: 83.2241 } }
