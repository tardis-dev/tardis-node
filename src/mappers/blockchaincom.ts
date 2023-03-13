import { upperCaseSymbols } from '../handy'
import { BookChange, Trade } from '../types'
import { Mapper } from './mapper'

export class BlockchainComTradesMapper implements Mapper<'blockchain-com', Trade> {
  canHandle(message: BlockchainComTradeMessage) {
    return message.channel === 'trades' && message.event === 'updated'
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

  *map(message: BlockchainComTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      symbol: message.symbol,
      exchange: 'blockchain-com',
      id: message.trade_id,
      price: message.price,
      amount: message.qty,
      side: message.side === 'sell' ? 'sell' : 'buy',
      timestamp: new Date(message.timestamp),
      localTimestamp: localTimestamp
    }
  }
}

export class BlockchainComBookChangeMapper implements Mapper<'blockchain-com', BookChange> {
  canHandle(message: BlockchainComL2Message) {
    return message.channel == 'l2' && (message.event === 'snapshot' || message.event === 'updated')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'l2',
        symbols
      }
    ]
  }

  *map(message: BlockchainComL2Message, localTimestamp: Date): IterableIterator<BookChange> {
    yield {
      type: 'book_change',
      symbol: message.symbol,
      exchange: 'blockchain-com',
      isSnapshot: message.event === 'snapshot',
      bids: message.bids.map(this.mapBookLevel),
      asks: message.asks.map(this.mapBookLevel),
      timestamp: new Date(message.timestamp),
      localTimestamp
    }
  }

  protected mapBookLevel(level: { px: number; qty: number }) {
    return { price: level.px, amount: level.qty }
  }
}

type BlockchainComTradeMessage = {
  seqnum: 408403
  event: 'updated'
  channel: 'trades'
  symbol: 'ETH-USDT'
  timestamp: '2023-02-23T03:02:11.503718Z'
  side: 'sell'
  qty: 0.60192856
  price: 1677.94
  trade_id: '844558083396024'
}

type BlockchainComL2Message =
  | {
      seqnum: 482554
      event: 'updated'
      channel: 'l2'
      symbol: 'DOT-GBP'
      bids: [{ num: 1; px: 6.08; qty: 137.77377093 }]
      asks: []
      timestamp: '2023-02-23T03:02:11.535015Z'
    }
  | {
      seqnum: 269087
      event: 'snapshot'
      channel: 'l2'
      symbol: 'BTC-USD'
      bids: [{ num: 1; px: 1.8; qty: 7.45715496 }]
      asks: [{ num: 1; px: 24187.8; qty: 0.04175659 }]
      timestamp: '2023-02-23T00:00:00.127804Z'
    }
