import { upperCaseSymbols } from '../handy'
import { BookChange, Exchange, Trade } from '../types'
import { Mapper } from './mapper'

// https://www.gate.io/docs/websocket/index.html

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
    yield {
      type: 'book_change',
      symbol,
      exchange: this._exchange,
      isSnapshot,
      bids: bids.map(mapBookLevel),
      asks: asks.map(mapBookLevel),
      timestamp: localTimestamp,
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
    },
    string
  ]
}
