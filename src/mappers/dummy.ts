import { upperCaseSymbols } from '../handy'
import { BookChange, Exchange, Trade } from '../types'
import { Mapper } from './mapper'

export class DummyTradesMapper implements Mapper<'dummy', Trade> {
  canHandle(_message: any) {
    return true
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trade',
        symbols
      } as const
    ]
  }

  *map(trade: DummyTrade, localTimestamp: Date): IterableIterator<Trade> {
    const timestamp = new Date(trade.t * 1000)
    timestamp.μs = Math.floor(trade.t * 1000000) % 1000
    yield {
      type: 'trade',
      symbol: trade.s,
      exchange: 'dummy',
      id: trade.i,
      price: trade.p,
      amount: trade.a,
      side: trade.tp == 's' ? 'sell' : 'buy',
      timestamp,
      localTimestamp: localTimestamp
    }
  }
}

type DummyTrade = {
  i: string
  t: number
  s: string
  p: number
  a: number
  tp: 's' | 'b'
}

type DummyDepthLevel = [string, string]
