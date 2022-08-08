import { upperCaseSymbols } from '../handy'
import { BookChange, Trade } from '../types'
import { Mapper } from './mapper'

export class PoloniexV2TradesMapper implements Mapper<'poloniex', Trade> {
  canHandle(message: any) {
    return message.channel === 'trades' && message.data !== undefined && message.data.length > 0
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trades',
        symbols
      } as const
    ]
  }

  *map(message: PoloniexV2TradesMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const item of message.data) {
      yield {
        type: 'trade',
        symbol: item.symbol,
        exchange: 'poloniex',
        id: item.id,
        price: Number(item.price),
        amount: Number(item.quantity),
        side: item.takerSide === 'sell' ? 'sell' : 'buy',
        timestamp: new Date(item.createTime),
        localTimestamp: localTimestamp
      }
    }
  }
}

const mapBookLevelV2 = (level: [string, string]) => {
  return {
    price: Number(level[0]),
    amount: Number(level[1])
  }
}
export class PoloniexV2BookChangeMapper implements Mapper<'poloniex', BookChange> {
  canHandle(message: any) {
    return message.channel === 'book_lv2' && message.data !== undefined && message.data.length > 0
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'book_lv2',
        symbols
      } as const
    ]
  }

  *map(message: PoloniexV2BookMessage, localTimestamp: Date): IterableIterator<BookChange> {
    for (const item of message.data) {
      const bookSnapshot: BookChange = {
        type: 'book_change',
        symbol: item.symbol,
        exchange: 'poloniex',
        isSnapshot: message.action === 'snapshot',
        bids: item.bids.map(mapBookLevelV2),
        asks: item.asks.map(mapBookLevelV2),
        timestamp: new Date(item.ts),
        localTimestamp: localTimestamp
      }

      yield bookSnapshot
    }
  }
}

export class PoloniexTradesMapper implements Mapper<'poloniex', Trade> {
  private readonly _channelIdToSymbolMap: Map<number, string> = new Map()

  canHandle(message: PoloniexPriceAggreatedMessage) {
    if (Array.isArray(message) === false) {
      return false
    }

    if (message.length < 3) {
      return false
    }
    // store mapping between channel id and symbols
    if (message[2][0][0] === 'i') {
      this._channelIdToSymbolMap.set(message[0], message[2][0][1].currencyPair)
    }

    return message[2].some((m) => m[0] === 't')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'price_aggregated_book',
        symbols
      } as const
    ]
  }

  *map(message: PoloniexPriceAggreatedMessage, localTimestamp: Date): IterableIterator<Trade> {
    const lastItem = message[message.length - 1]
    const symbol = typeof lastItem === 'string' ? lastItem : this._channelIdToSymbolMap.get(message[0])

    if (symbol === undefined) {
      return
    }

    for (const item of message[2]) {
      if (item[0] !== 't') {
        continue
      }

      const [_, id, side, price, size, timestamp] = item

      yield {
        type: 'trade',
        symbol,
        exchange: 'poloniex',
        id: String(id),
        price: Number(price),
        amount: Number(size),
        side: side === 1 ? 'buy' : 'sell',
        timestamp: new Date(timestamp * 1000),
        localTimestamp: localTimestamp
      }
    }
  }
}

const mapSnapshotLevels = (levels: { [key: string]: string }) => {
  return Object.keys(levels).map((key) => {
    return {
      price: Number(key),
      amount: Number(levels[key])
    }
  })
}

const mapBookLevel = (level: PoloniexBookUpdate) => {
  return {
    price: Number(level[2]),
    amount: Number(level[3])
  }
}

export class PoloniexBookChangeMapper implements Mapper<'poloniex', BookChange> {
  private readonly _channelIdToSymbolMap: Map<number, string> = new Map()

  canHandle(message: PoloniexPriceAggreatedMessage) {
    if (Array.isArray(message) === false) {
      return false
    }

    if (message.length < 3) {
      return false
    }
    // store mapping between channel id and symbols
    if (message[2][0][0] === 'i') {
      this._channelIdToSymbolMap.set(message[0], message[2][0][1].currencyPair)
    }

    return message[2].some((m) => m[0] === 'i' || m[0] === 'o')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'price_aggregated_book',
        symbols
      } as const
    ]
  }

  *map(message: PoloniexPriceAggreatedMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const lastItem = message[message.length - 1]
    const symbol = typeof lastItem === 'string' ? lastItem : this._channelIdToSymbolMap.get(message[0])

    if (symbol === undefined) {
      return
    }

    let updates = []

    for (const item of message[2]) {
      if (item[0] === 'i') {
        const bookSnapshot: BookChange = {
          type: 'book_change',
          symbol,
          exchange: 'poloniex',
          isSnapshot: true,
          bids: mapSnapshotLevels(item[1].orderBook[1]),
          asks: mapSnapshotLevels(item[1].orderBook[0]),
          timestamp: localTimestamp,
          localTimestamp: localTimestamp
        }

        yield bookSnapshot
      } else if (item[0] === 'o') {
        updates.push(item)
      }
    }

    if (updates.length > 0) {
      const bookUpdate: BookChange = {
        type: 'book_change',
        symbol,
        exchange: 'poloniex',
        isSnapshot: false,
        bids: updates.filter((u) => u[1] == 1).map(mapBookLevel),
        asks: updates.filter((u) => u[1] == 0).map(mapBookLevel),
        timestamp: localTimestamp,
        localTimestamp: localTimestamp
      }

      yield bookUpdate
    }
  }
}

type PoloniexBookSnapshot = ['i', { currencyPair: string; orderBook: [{ [key: string]: string }, { [key: string]: string }] }]
type PoloniexBookUpdate = ['o', 0 | 1, string, string]
type PoloniexTrade = ['t', string, 1 | 0, string, string, number]

type PoloniexPriceAggreatedMessage = [number, number, (PoloniexBookSnapshot | PoloniexBookUpdate | PoloniexTrade)[], string?]

type PoloniexV2SubscribeMessage = {
  event: 'subscribe'
  channel: 'trades'
  symbols: string[]
}

type PoloniexV2TradesMessage = {
  channel: 'trades'
  data: [
    {
      symbol: 'USDD_USDT'
      amount: '53.17153856'
      quantity: '53.0866'
      takerSide: 'sell'
      createTime: 1659916859838
      price: '1.0016'
      id: '60100203'
      ts: 1659916859843
    }
  ]
}

type PoloniexV2BookMessage =
  | {
      channel: 'book_lv2'
      data: [
        {
          symbol: 'AAVE_BTC'
          createTime: 1659916859818
          asks: [string, string][]
          bids: [string, string][]
          lastId: 20251
          id: 20252
          ts: 1659916859824
        }
      ]
      action: 'update'
    }
  | {
      channel: 'book_lv2'
      data: [
        {
          symbol: 'AAVE_BTC'
          createTime: 1659900600092
          asks: [string, string][]
          bids: [string, string][]
          lastId: 85
          id: 86
          ts: 1659916800614
        }
      ]
      action: 'snapshot'
    }
