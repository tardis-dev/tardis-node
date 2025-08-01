import { debug } from '../debug'
import { CircularBuffer, fromMicroSecondsToDate, upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, Exchange, Trade } from '../types'
import { Mapper } from './mapper'

export class GateIOV4OrderBookV2ChangeMapper implements Mapper<'gate-io', BookChange> {
  constructor(protected readonly exchange: Exchange) {}

  canHandle(message: GateV4OrderBookV2Message) {
    return message.channel === 'spot.obu' && message.event === 'update'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'obu',
        symbols
      } as const
    ]
  }

  *map(message: GateV4OrderBookV2Message, localTimestamp: Date) {
    const result = message.result
    const symbol = this.extractSymbolFromStream(result.s)

    const isSnapshot = result.full === true

    const bookChange: BookChange = {
      type: 'book_change',
      symbol,
      exchange: this.exchange,
      isSnapshot,
      bids: (result.b || []).map(this.mapBookLevel),
      asks: (result.a || []).map(this.mapBookLevel),
      timestamp: new Date(result.t),
      localTimestamp
    }

    yield bookChange
  }

  protected mapBookLevel(level: [string, string]) {
    const price = Number(level[0])
    const amount = Number(level[1])
    return { price, amount }
  }

  private extractSymbolFromStream(streamName: string): string {
    const lastDotIndex = streamName.lastIndexOf('.')

    return streamName.slice(3, lastDotIndex)
  }
}
//v4

export class GateIOV4BookChangeMapper implements Mapper<'gate-io', BookChange> {
  protected readonly symbolToDepthInfoMapping: {
    [key: string]: LocalDepthInfo
  } = {}

  constructor(protected readonly exchange: Exchange, protected readonly ignoreBookSnapshotOverlapError: boolean) {}

  canHandle(message: GateV4OrderBookUpdate | Gatev4OrderBookSnapshot) {
    if (message.channel === undefined) {
      return false
    }
    if (message.event !== 'update' && message.event !== 'snapshot') {
      return false
    }

    return message.channel.endsWith('order_book_update')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'order_book_update',
        symbols
      } as const
    ]
  }

  *map(message: GateV4OrderBookUpdate | Gatev4OrderBookSnapshot, localTimestamp: Date) {
    const symbol = message.event === 'snapshot' ? message.symbol : message.result.s

    if (this.symbolToDepthInfoMapping[symbol] === undefined) {
      this.symbolToDepthInfoMapping[symbol] = {
        bufferedUpdates: new CircularBuffer<DepthData>(2000)
      }
    }

    const symbolDepthInfo = this.symbolToDepthInfoMapping[symbol]
    const snapshotAlreadyProcessed = symbolDepthInfo.snapshotProcessed

    // first check if received message is snapshot and process it as such if it is
    if (message.event === 'snapshot') {
      // if we've already received 'manual' snapshot, ignore if there is another one
      if (snapshotAlreadyProcessed) {
        return
      }
      // produce snapshot book_change
      const snapshotData = message.result

      //  mark given symbol depth info that has snapshot processed
      symbolDepthInfo.lastUpdateId = snapshotData.id
      symbolDepthInfo.snapshotProcessed = true

      // if there were any depth updates buffered, let's proccess those by adding to or updating the initial snapshot
      for (const update of symbolDepthInfo.bufferedUpdates.items()) {
        const bookChange = this.mapBookDepthUpdate(update, localTimestamp)
        if (bookChange !== undefined) {
          for (const bid of update.b) {
            const matchingBid = snapshotData.bids.find((b) => b[0] === bid[0])
            if (matchingBid !== undefined) {
              matchingBid[1] = bid[1]
            } else {
              snapshotData.bids.push(bid)
            }
          }

          for (const ask of update.a) {
            const matchingAsk = snapshotData.asks.find((a) => a[0] === ask[0])
            if (matchingAsk !== undefined) {
              matchingAsk[1] = ask[1]
            } else {
              snapshotData.asks.push(ask)
            }
          }
        }
      }

      // remove all buffered updates
      symbolDepthInfo.bufferedUpdates.clear()

      const bookChange: BookChange = {
        type: 'book_change',
        symbol,
        exchange: this.exchange,
        isSnapshot: true,
        bids: snapshotData.bids.map(this.mapBookLevel),
        asks: snapshotData.asks.map(this.mapBookLevel),
        timestamp: new Date(snapshotData.update),
        localTimestamp
      }

      yield bookChange
    } else if (snapshotAlreadyProcessed) {
      // snapshot was already processed let's map the message as normal book_change
      const bookChange = this.mapBookDepthUpdate(message.result as DepthData, localTimestamp)
      if (bookChange !== undefined) {
        yield bookChange
      }
    } else {
      const depthUpdate = message.result as DepthData

      symbolDepthInfo.bufferedUpdates.append(depthUpdate)
    }
  }

  protected mapBookDepthUpdate(depthUpdateData: DepthData, localTimestamp: Date): BookChange | undefined {
    // we can safely assume here that depthContext and lastUpdateId aren't null here as this is method only works
    // when we've already processed the snapshot
    const depthContext = this.symbolToDepthInfoMapping[depthUpdateData.s]!
    const lastUpdateId = depthContext.lastUpdateId!

    // Drop any event where u is <= lastUpdateId in the snapshot
    if (depthUpdateData.u <= lastUpdateId) {
      return
    }

    // The first processed event should have U <= lastUpdateId+1 AND u >= lastUpdateId+1.
    if (!depthContext.validatedFirstUpdate) {
      // if there is new instrument added it can have empty book at first and that's normal
      const bookSnapshotIsEmpty = lastUpdateId == -1

      if ((depthUpdateData.U <= lastUpdateId + 1 && depthUpdateData.u >= lastUpdateId + 1) || bookSnapshotIsEmpty) {
        depthContext.validatedFirstUpdate = true
      } else {
        const message = `Book depth snapshot has no overlap with first update, update ${JSON.stringify(
          depthUpdateData
        )}, lastUpdateId: ${lastUpdateId}, exchange ${this.exchange}`

        if (this.ignoreBookSnapshotOverlapError) {
          depthContext.validatedFirstUpdate = true
          debug(message)
        } else {
          throw new Error(message)
        }
      }
    }

    return {
      type: 'book_change',
      symbol: depthUpdateData.s,
      exchange: this.exchange,
      isSnapshot: false,

      bids: depthUpdateData.b.map(this.mapBookLevel),
      asks: depthUpdateData.a.map(this.mapBookLevel),
      timestamp: fromMicroSecondsToDate(depthUpdateData.t),
      localTimestamp: localTimestamp
    }
  }

  protected mapBookLevel(level: [string, string]) {
    const price = Number(level[0])
    const amount = Number(level[1])
    return { price, amount }
  }
}

export class GateIOV4BookTickerMapper implements Mapper<'gate-io', BookTicker> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: GateV4BookTicker) {
    if (message.channel === undefined) {
      return false
    }
    if (message.event !== 'update') {
      return false
    }

    return message.channel.endsWith('book_ticker')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'book_ticker',
        symbols
      } as const
    ]
  }

  *map(bookTickerResponse: GateV4BookTicker, localTimestamp: Date) {
    const gateBookTicker = bookTickerResponse.result

    const ticker: BookTicker = {
      type: 'book_ticker',
      symbol: gateBookTicker.s,
      exchange: this._exchange,
      askAmount: gateBookTicker.A !== undefined ? Number(gateBookTicker.A) : undefined,
      askPrice: gateBookTicker.a !== undefined ? Number(gateBookTicker.a) : undefined,
      bidPrice: gateBookTicker.b !== undefined ? Number(gateBookTicker.b) : undefined,
      bidAmount: gateBookTicker.B !== undefined ? Number(gateBookTicker.B) : undefined,
      timestamp: gateBookTicker.t !== undefined ? new Date(gateBookTicker.t) : localTimestamp,
      localTimestamp: localTimestamp
    }

    yield ticker
  }
}

export class GateIOV4TradesMapper implements Mapper<'gate-io', Trade> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: GateV4Trade) {
    if (message.channel === undefined) {
      return false
    }
    if (message.event !== 'update') {
      return false
    }

    return message.channel.endsWith('trades')
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

  *map(tradesMessage: GateV4Trade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: tradesMessage.result.currency_pair,
      exchange: this._exchange,
      id: tradesMessage.result.id.toString(),
      price: Number(tradesMessage.result.price),
      amount: Number(tradesMessage.result.amount),
      side: tradesMessage.result.side == 'sell' ? 'sell' : 'buy',
      timestamp: new Date(Number(tradesMessage.result.create_time_ms)),
      localTimestamp: localTimestamp
    }
  }
}

// v3 https://www.gate.io/docs/websocket/index.html

export class GateIOTradesMapper implements Mapper<'gate-io', Trade> {
  private readonly _seenSymbols = new Set<string>()

  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: any) {
    return message.method === 'trades.update'
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

  *map(tradesMessage: GateIOTrades, localTimestamp: Date): IterableIterator<Trade> {
    const symbol = tradesMessage.params[0]

    if (!tradesMessage.params[1]) {
      return
    }

    // gate io sends trades from newest to oldest for some reason
    for (const gateIOTrade of tradesMessage.params[1].reverse()) {
      // always ignore first returned trade as it's a 'stale' trade, which has already been published before disconnect
      if (this._seenSymbols.has(symbol) === false) {
        this._seenSymbols.add(symbol)
        break
      }

      const timestamp = new Date(gateIOTrade.time * 1000)
      timestamp.μs = Math.floor(gateIOTrade.time * 1000000) % 1000
      yield {
        type: 'trade',
        symbol,
        exchange: this._exchange,
        id: gateIOTrade.id.toString(),
        price: Number(gateIOTrade.price),
        amount: Number(gateIOTrade.amount),
        side: gateIOTrade.type == 'sell' ? 'sell' : 'buy',
        timestamp,
        localTimestamp: localTimestamp
      }
    }
  }
}

const mapBookLevel = (level: GateIODepthLevel) => {
  const price = Number(level[0])
  const amount = Number(level[1])

  return { price, amount }
}

export class GateIOBookChangeMapper implements Mapper<'gate-io', BookChange> {
  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: any) {
    return message.method === 'depth.update'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'depth',
        symbols
      } as const
    ]
  }

  *map(depthMessage: GateIODepth, localTimestamp: Date): IterableIterator<BookChange> {
    const symbol = depthMessage.params[2]
    const isSnapshot = depthMessage.params[0]
    const bids = Array.isArray(depthMessage.params[1].bids) ? depthMessage.params[1].bids : []
    const asks = Array.isArray(depthMessage.params[1].asks) ? depthMessage.params[1].asks : []

    const timestamp = depthMessage.params[1].current !== undefined ? new Date(depthMessage.params[1].current * 1000) : localTimestamp

    yield {
      type: 'book_change',
      symbol,
      exchange: this._exchange,
      isSnapshot,
      bids: bids.map(mapBookLevel),
      asks: asks.map(mapBookLevel),
      timestamp: timestamp,
      localTimestamp: localTimestamp
    }
  }
}

type GateIOTrade = {
  id: number
  time: number
  price: string
  amount: string
  type: 'sell' | 'buy'
}

type GateIOTrades = {
  method: 'trades.update'
  params: [string, GateIOTrade[]]
}
type GateIODepthLevel = [string, string]

type GateIODepth = {
  method: 'depth.update'
  params: [
    boolean,
    {
      bids?: GateIODepthLevel[]
      asks?: GateIODepthLevel[]
      current: 1669860180.632
      update: 1669860180.632
    },
    string
  ]
}

type GateV4Trade = {
  time: 1682689046
  time_ms: 1682689046133
  channel: 'spot.trades'
  event: 'update'
  result: {
    id: 5541729596
    create_time: 1682689046
    create_time_ms: '1682689046123.0'
    side: 'sell'
    currency_pair: 'SUSD_USDT'
    amount: '8.5234'
    price: '0.9782'
  }
}

type GateV4BookTicker = {
  time: 1682689046
  time_ms: 1682689046142
  channel: 'spot.book_ticker'
  event: 'update'
  result: { t: 1682689046131; u: 517377894; s: 'ETC_ETH'; b: '0.010326'; B: '0.001'; a: '0.010366'; A: '10' }
}

type Gatev4OrderBookSnapshot = {
  channel: 'spot.order_book_update'
  event: 'snapshot'
  generated: true
  symbol: '1ART_USDT'
  result: {
    id: 154857784
    current: 1682689045318
    update: 1682689045056
    asks: [string, string][]
    bids: [string, string][]
  }
}

type GateV4OrderBookUpdate = {
  time: 1682689045
  time_ms: 1682689045532
  channel: 'spot.order_book_update'
  event: 'update'
  result: {
    lastUpdateId: undefined
    t: 1682689045424
    e: 'depthUpdate'
    E: 1682689045
    s: '1ART_USDT'
    U: 154857785
    u: 154857785
    b: [string, string][]
    a: [string, string][]
  }
}

type LocalDepthInfo = {
  bufferedUpdates: CircularBuffer<DepthData>
  snapshotProcessed?: boolean
  lastUpdateId?: number
  validatedFirstUpdate?: boolean
}

type DepthData = {
  lastUpdateId: undefined
  t: number
  s: string
  U: number
  u: number
  b: [string, string][]
  a: [string, string][]
}

type GateV4OrderBookV2Message = {
  channel: 'spot.obu'
  event: 'update'
  time_ms: number
  result: {
    t: number
    s: string
    u: number
    U?: number
    full?: boolean
    b?: [string, string][]
    a?: [string, string][]
  }
}
