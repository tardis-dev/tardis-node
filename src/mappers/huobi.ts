import { BookChange, Exchange, Trade } from '../types'
import { Mapper } from './mapper'

// https://huobiapi.github.io/docs/spot/v1/en/#websocket-market-data
// https://github.com/huobiapi/API_Docs_en/wiki/WS_api_reference_en

export class HuobiTradesMapper implements Mapper<'huobi' | 'huobi-dm' | 'huobi-dm-swap', Trade> {
  private readonly _seenSymbols = new Set<string>()

  constructor(private readonly _exchange: Exchange) {}
  canHandle(message: HuobiDataMessage) {
    if (message.ch === undefined) {
      return false
    }
    return message.ch.endsWith('.trade.detail')
  }

  getFilters(symbols?: string[]) {
    symbols = normalizeSymbols(symbols)

    return [
      {
        channel: 'trade',
        symbols
      } as const
    ]
  }

  *map(message: HuobiTradeDataMessage, localTimestamp: Date): IterableIterator<Trade> {
    const symbol = message.ch.split('.')[1].toUpperCase()

    // always ignore first returned trade as it's a 'stale' trade, which has already been published before disconnect
    if (this._seenSymbols.has(symbol) === false) {
      this._seenSymbols.add(symbol)
      return
    }

    for (const huobiTrade of message.tick.data) {
      yield {
        type: 'trade',
        symbol,
        exchange: this._exchange,
        id: String(huobiTrade.tradeId !== undefined ? huobiTrade.tradeId : huobiTrade.id),
        price: huobiTrade.price,
        amount: huobiTrade.amount,
        side: huobiTrade.direction,
        timestamp: new Date(huobiTrade.ts),
        localTimestamp: localTimestamp
      }
    }
  }
}

export class HuobiBookChangeMapper implements Mapper<'huobi' | 'huobi-dm' | 'huobi-dm-swap', BookChange> {
  constructor(protected readonly _exchange: Exchange) {}

  canHandle(message: HuobiDataMessage) {
    if (message.ch === undefined) {
      return false
    }

    return message.ch.includes('.depth.')
  }

  getFilters(symbols?: string[]) {
    symbols = normalizeSymbols(symbols)

    return [
      {
        channel: 'depth',
        symbols
      } as const
    ]
  }

  *map(message: HuobiDepthDataMessage, localTimestamp: Date) {
    const symbol = message.ch.split('.')[1].toUpperCase()
    const isSnapshot = 'event' in message.tick ? message.tick.event === 'snapshot' : 'update' in message ? false : true
    const data = message.tick
    const bids = Array.isArray(data.bids) ? data.bids : []
    const asks = Array.isArray(data.asks) ? data.asks : []

    yield {
      type: 'book_change',
      symbol,
      exchange: this._exchange,
      isSnapshot,
      bids: bids.map(this._mapBookLevel),
      asks: asks.map(this._mapBookLevel),
      timestamp: new Date(message.ts),
      localTimestamp: localTimestamp
    } as const
  }

  private _mapBookLevel(level: HuobiBookLevel) {
    return { price: level[0], amount: level[1] }
  }
}

function normalizeSymbols(symbols?: string[]) {
  if (symbols !== undefined) {
    return symbols.map((s) => {
      // huobi-dm and huobi-dm-swap expects symbols to be upper cases
      if (s.includes('_') || s.includes('-')) {
        return s
      }
      // huobi global and us expects lower cased symbols
      return s.toLowerCase()
    })
  }
  return
}

type HuobiDataMessage = {
  ch: string
}

type HuobiTradeDataMessage = HuobiDataMessage & {
  tick: {
    data: {
      id: number
      tradeId?: number
      price: number
      amount: number
      direction: 'buy' | 'sell'
      ts: number
    }[]
  }
}

type HuobiBookLevel = [number, number]

type HuobiDepthDataMessage = HuobiDataMessage &
  (
    | {
        update?: boolean
        ts: number
        tick: {
          bids: HuobiBookLevel[] | null
          asks: HuobiBookLevel[] | null
        }
      }
    | {
        ts: number
        tick: {
          bids: HuobiBookLevel[] | null
          asks: HuobiBookLevel[] | null
          event: 'snapshot' | 'update'
        }
      }
  )
