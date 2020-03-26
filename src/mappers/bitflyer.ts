import { parseμs } from '../handy'
import { BookChange, Trade } from '../types'
import { Mapper } from './mapper'

export const bitflyerTradesMapper: Mapper<'bitflyer', Trade> = {
  canHandle(message: BitflyerExecutions | BitflyerBoard) {
    return message.params.channel.startsWith('lightning_executions')
  },

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'lightning_executions',
        symbols
      }
    ]
  },

  *map(bitflyerExecutions: BitflyerExecutions, localTimestamp: Date) {
    const symbol = bitflyerExecutions.params.channel.replace('lightning_executions_', '')

    for (const execution of bitflyerExecutions.params.message) {
      const timestamp = new Date(execution.exec_date)
      timestamp.μs = parseμs(execution.exec_date)

      yield {
        type: 'trade',
        symbol,
        exchange: 'bitflyer',
        id: String(execution.id),
        price: execution.price,
        amount: execution.size,
        side: execution.side === 'BUY' ? 'buy' : execution.side === 'SELL' ? 'sell' : 'unknown',
        timestamp,
        localTimestamp: localTimestamp
      }
    }
  }
}

const mapBookLevel = ({ price, size }: BitflyerBookLevel) => {
  return { price, amount: size }
}

export const bitflyerBookChangeMapper: Mapper<'bitflyer', BookChange> = {
  canHandle(message: BitflyerExecutions | BitflyerBoard) {
    return message.params.channel.startsWith('lightning_board')
  },

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'lightning_board_snapshot',
        symbols
      },
      {
        channel: 'lightning_board',
        symbols
      }
    ]
  },

  *map(bitflyerBoard: BitflyerBoard, localTimestamp: Date): IterableIterator<BookChange> {
    const channel = bitflyerBoard.params.channel
    const isSnapshot = channel.startsWith('lightning_board_snapshot_')
    const symbol = isSnapshot ? channel.replace('lightning_board_snapshot_', '') : channel.replace('lightning_board_', '')

    yield {
      type: 'book_change',
      symbol,
      exchange: 'bitflyer',
      isSnapshot,
      bids: bitflyerBoard.params.message.bids.map(mapBookLevel),
      asks: bitflyerBoard.params.message.asks.map(mapBookLevel),
      timestamp: localTimestamp,
      localTimestamp
    }
  }
}

type BitflyerExecutions = {
  method: 'channelMessage'
  params: {
    channel: string
    message: {
      id: number
      side: 'SELL' | 'BUY'
      price: number
      size: number
      exec_date: string
    }[]
  }
}

type BitflyerBookLevel = {
  price: number
  size: number
}

type BitflyerBoard = {
  method: 'channelMessage'
  params: {
    channel: 'lightning_board_snapshot_ETH_BTC'
    message: {
      bids: BitflyerBookLevel[]
      asks: BitflyerBookLevel[]
    }
  }
}
