import { BookChange, Exchange, Trade } from '../types'
import { Mapper } from './mapper'

// https://huobiapi.github.io/docs/spot/v1/en/#websocket-market-data
// https://github.com/huobiapi/API_Docs_en/wiki/WS_api_reference_en

export class HuobiTradesMapper implements Mapper<'huobi' | 'huobi-dm', Trade> {
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

export class HuobiBookChangeMapper implements Mapper<'huobi' | 'huobi-dm', BookChange> {
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
    yield {
      type: 'book_change',
      symbol,
      exchange: this._exchange,
      isSnapshot,
      bids: data.bids.map(this._mapBookLevel),
      asks: data.asks.map(this._mapBookLevel),
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
      // huobi-dm expects symbols to be upper cases
      if (s.includes('_')) {
        return s
      }
      // huobi-com and us expects lower cased symbols
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
          bids: HuobiBookLevel[]
          asks: HuobiBookLevel[]
        }
      }
    | {
        ts: number
        tick: {
          bids: HuobiBookLevel[]
          asks: HuobiBookLevel[]
          event: 'snapshot' | 'update'
        }
      }
  )
