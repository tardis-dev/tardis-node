import { debug } from '../debug'
import { CircularBuffer, upperCaseSymbols } from '../handy'
import { BookChange, Exchange, BookTicker, Trade, BookPriceLevel } from '../types'
import { Mapper } from './mapper'

export class KucoinTradesMapper implements Mapper<'kucoin', Trade> {
  constructor(private readonly _exchange: Exchange) {}
  canHandle(message: KucoinTradeMessage) {
    return message.type === 'message' && message.topic.startsWith('/market/match')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'market/match',
        symbols
      } as const
    ]
  }

  *map(message: KucoinTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    const kucoinTrade = message.data

    const timestamp = new Date(Number(kucoinTrade.time.slice(0, 13)))

    timestamp.μs = Number(kucoinTrade.time.slice(13, 16))

    yield {
      type: 'trade',
      symbol: kucoinTrade.symbol,
      exchange: this._exchange,
      id: kucoinTrade.tradeId,
      price: Number(kucoinTrade.price),
      amount: Number(kucoinTrade.size),
      side: kucoinTrade.side === 'sell' ? 'sell' : 'buy',
      timestamp,
      localTimestamp
    }
  }
}

export class KucoinBookChangeMapper implements Mapper<'kucoin', BookChange> {
  protected readonly symbolToDepthInfoMapping: {
    [key: string]: LocalDepthInfo
  } = {}

  constructor(protected readonly _exchange: Exchange, private readonly ignoreBookSnapshotOverlapError: boolean) {}

  canHandle(message: KucoinLevel2SnapshotMessage | KucoinLevel2UpdateMessage) {
    return message.type === 'message' && message.topic.startsWith('/market/level2')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'market/level2',
        symbols
      } as const,
      {
        channel: 'market/level2Snapshot',
        symbols
      } as const
    ]
  }

  *map(message: KucoinLevel2SnapshotMessage | KucoinLevel2UpdateMessage, localTimestamp: Date) {
    const symbol = message.topic.split(':')[1]

    if (this.symbolToDepthInfoMapping[symbol] === undefined) {
      this.symbolToDepthInfoMapping[symbol] = {
        bufferedUpdates: new CircularBuffer<KucoinLevel2UpdateMessage>(2000)
      }
    }

    const symbolDepthInfo = this.symbolToDepthInfoMapping[symbol]
    const snapshotAlreadyProcessed = symbolDepthInfo.snapshotProcessed

    // first check if received message is snapshot and process it as such if it is
    if (message.subject === 'trade.l2Snapshot') {
      // if we've already received 'manual' snapshot, ignore if there is another one
      if (snapshotAlreadyProcessed) {
        return
      }
      // produce snapshot book_change
      const kucoinSnapshotData = message.data
      if (!kucoinSnapshotData.asks) {
        kucoinSnapshotData.asks = []
      }
      if (!kucoinSnapshotData.bids) {
        kucoinSnapshotData.bids = []
      }

      //  mark given symbol depth info that has snapshot processed
      symbolDepthInfo.lastUpdateId = Number(kucoinSnapshotData.sequence)
      symbolDepthInfo.snapshotProcessed = true

      // if there were any depth updates buffered, let's proccess those by adding to or updating the initial snapshot
      for (const update of symbolDepthInfo.bufferedUpdates.items()) {
        const bookChange = this.mapBookDepthUpdate(update, localTimestamp)
        if (bookChange !== undefined) {
          for (const bid of update.data.changes.bids) {
            if (bid[0] == '0') {
              continue
            }
            const matchingBid = kucoinSnapshotData.bids.find((b) => b[0] === bid[0])
            if (matchingBid !== undefined) {
              matchingBid[1] = bid[1]
            } else {
              kucoinSnapshotData.bids.push([bid[0], bid[1]])
            }
          }

          for (const ask of update.data.changes.asks) {
            if (ask[0] == '0') {
              continue
            }

            const matchingAsk = kucoinSnapshotData.asks.find((a) => a[0] === ask[0])
            if (matchingAsk !== undefined) {
              matchingAsk[1] = ask[1]
            } else {
              kucoinSnapshotData.asks.push([ask[0], ask[1]])
            }
          }
        }
      }

      // remove all buffered updates
      symbolDepthInfo.bufferedUpdates.clear()

      const bookChange: BookChange = {
        type: 'book_change',
        symbol,
        exchange: this._exchange,
        isSnapshot: true,
        bids: kucoinSnapshotData.bids.map(this.mapBookLevel),
        asks: kucoinSnapshotData.asks.map(this.mapBookLevel),
        timestamp: localTimestamp,
        localTimestamp
      }

      yield bookChange
    } else if (snapshotAlreadyProcessed) {
      // snapshot was already processed let's map the message as normal book_change
      const bookChange = this.mapBookDepthUpdate(message, localTimestamp)
      if (bookChange !== undefined) {
        yield bookChange
      }
    } else {
      symbolDepthInfo.bufferedUpdates.append(message)
    }
  }

  protected mapBookDepthUpdate(l2UpdateMessage: KucoinLevel2UpdateMessage, localTimestamp: Date): BookChange | undefined {
    // we can safely assume here that depthContext and lastUpdateId aren't null here as this is method only works
    // when we've already processed the snapshot
    const depthContext = this.symbolToDepthInfoMapping[l2UpdateMessage.data.symbol]!
    const lastUpdateId = depthContext.lastUpdateId!

    // Drop any event where sequenceEnd is <= lastUpdateId in the snapshot
    if (l2UpdateMessage.data.sequenceEnd <= lastUpdateId) {
      return
    }

    // The first processed event should have sequenceStart <= lastUpdateId+1 AND sequenceEnd >= lastUpdateId+1.
    if (!depthContext.validatedFirstUpdate) {
      // if there is new instrument added it can have empty book at first and that's normal
      const bookSnapshotIsEmpty = lastUpdateId == -1 || lastUpdateId == 0

      if (
        (l2UpdateMessage.data.sequenceStart <= lastUpdateId + 1 && l2UpdateMessage.data.sequenceEnd >= lastUpdateId + 1) ||
        bookSnapshotIsEmpty
      ) {
        depthContext.validatedFirstUpdate = true
      } else {
        const message = `Book depth snapshot has no overlap with first update, update ${JSON.stringify(
          l2UpdateMessage
        )}, lastUpdateId: ${lastUpdateId}, exchange ${this._exchange}`
        if (this.ignoreBookSnapshotOverlapError) {
          depthContext.validatedFirstUpdate = true
          debug(message)
        } else {
          throw new Error(message)
        }
      }
    }
    const bids = l2UpdateMessage.data.changes.bids.map(this.mapBookLevel).filter(this.nonZeroLevels)
    const asks = l2UpdateMessage.data.changes.asks.map(this.mapBookLevel).filter(this.nonZeroLevels)

    if (bids.length === 0 && asks.length === 0) {
      return
    }

    return {
      type: 'book_change',
      symbol: l2UpdateMessage.data.symbol,
      exchange: this._exchange,
      isSnapshot: false,
      bids,
      asks,
      timestamp: localTimestamp,
      localTimestamp: localTimestamp
    }
  }

  private mapBookLevel(level: [string, string, string?]) {
    const price = Number(level[0])
    const amount = Number(level[1])
    return { price, amount }
  }

  private nonZeroLevels(level: BookPriceLevel) {
    return level.price > 0
  }
}

export class KucoinBookTickerMapper implements Mapper<'kucoin', BookTicker> {
  constructor(protected readonly _exchange: Exchange) {}

  canHandle(message: KucoinTickerMessage) {
    return message.type === 'message' && message.topic.startsWith('/market/ticker')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'market/ticker',
        symbols
      } as const
    ]
  }

  *map(message: KucoinTickerMessage, localTimestamp: Date) {
    const symbol = message.topic.split(':')[1]

    const bookTicker: BookTicker = {
      type: 'book_ticker',
      symbol,
      exchange: this._exchange,
      askAmount: message.data.bestAskSize !== undefined && message.data.bestAskSize !== null ? Number(message.data.bestAskSize) : undefined,
      askPrice: message.data.bestAsk !== undefined && message.data.bestAsk !== null ? Number(message.data.bestAsk) : undefined,
      bidPrice: message.data.bestBid !== undefined && message.data.bestBid !== null ? Number(message.data.bestBid) : undefined,
      bidAmount: message.data.bestBidSize !== undefined && message.data.bestBidSize !== null ? Number(message.data.bestBidSize) : undefined,
      timestamp: new Date(message.data.time),
      localTimestamp: localTimestamp
    }

    yield bookTicker
  }
}

type KucoinTickerMessage = {
  type: 'message'
  topic: '/market/ticker:ADA-USDT'
  subject: 'trade.ticker'
  data: {
    bestAsk: '0.549931'
    bestAskSize: '966.4756'
    bestBid: '0.549824'
    bestBidSize: '1050'
    price: '0.549825'
    sequence: '1623526404099'
    size: '1'
    time: 1660608019871
  }
}

type KucoinTradeMessage = {
  type: 'message'
  topic: '/market/match:BTC-USDT'
  subject: 'trade.l3match'
  data: {
    symbol: 'BTC-USDT'
    side: 'sell'
    type: 'match'
    makerOrderId: '62fadde41add68000167fb58'
    sequence: '1636276321894'
    size: '0.00001255'
    price: '24093.9'
    takerOrderId: '62faddfff0476c0001c86c71'
    time: '1660608000026914990'
    tradeId: '62fade002e113d292303a18b'
  }
}

type LocalDepthInfo = {
  bufferedUpdates: CircularBuffer<KucoinLevel2UpdateMessage>
  snapshotProcessed?: boolean
  lastUpdateId?: number
  validatedFirstUpdate?: boolean
}

type KucoinLevel2SnapshotMessage = {
  type: 'message'
  generated: true
  topic: '/market/level2Snapshot:BTC-USDT'
  subject: 'trade.l2Snapshot'
  code: '200000'
  data: {
    time: 1660608003710
    sequence: '1636276324355'
    bids: [string, string][] | null
    asks: [string, string][] | null
  }
}

type KucoinLevel2UpdateMessage = {
  type: 'message'
  topic: '/market/level2:BTC-USDT'
  subject: 'trade.l2update'
  data: {
    sequenceStart: 1636276324710
    symbol: 'BTC-USDT'
    changes: { asks: [string, string, string][]; bids: [string, string, string][] }
    sequenceEnd: 1636276324710
  }
}
