import { parseμs, upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, Trade } from '../types'
import { Mapper } from './mapper'

export const bitflyerTradesMapper: Mapper<'bitflyer', Trade> = {
  canHandle(message: BitflyerExecutions | BitflyerBoard) {
    return message.params.channel.startsWith('lightning_executions')
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

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

      const trade: Trade = {
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

      yield trade
    }
  }
}

const mapBookLevel = ({ price, size }: BitflyerBookLevel) => {
  return { price, amount: size }
}

export class BitflyerBookChangeMapper implements Mapper<'bitflyer', BookChange> {
  private readonly _snapshotsInfo: Map<string, boolean> = new Map()

  canHandle(message: BitflyerExecutions | BitflyerBoard) {
    return message.params.channel.startsWith('lightning_board')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'lightning_board_snapshot',
        symbols
      } as const,
      {
        channel: 'lightning_board',
        symbols
      } as const
    ]
  }

  *map(bitflyerBoard: BitflyerBoard, localTimestamp: Date): IterableIterator<BookChange> {
    const channel = bitflyerBoard.params.channel
    const isSnapshot = channel.startsWith('lightning_board_snapshot_')
    const symbol = isSnapshot ? channel.replace('lightning_board_snapshot_', '') : channel.replace('lightning_board_', '')

    if (this._snapshotsInfo.has(symbol) === false) {
      if (isSnapshot) {
        this._snapshotsInfo.set(symbol, true)
      } else {
        // skip change messages until we've received book snapshot
        return
      }
    }

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

export const bitflyerBookTickerMapper: Mapper<'bitflyer', BookTicker> = {
  canHandle(message: BitflyerTicker) {
    return message.params.channel.startsWith('lightning_ticker')
  },

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'lightning_ticker',
        symbols
      }
    ]
  },

  *map(bitflyerTickerMessage: BitflyerTicker, localTimestamp: Date) {
    const symbol = bitflyerTickerMessage.params.channel.replace('lightning_ticker_', '')
    const bitflyerTicker = bitflyerTickerMessage.params.message
    const timestamp = new Date(bitflyerTicker.timestamp)
    timestamp.μs = parseμs(bitflyerTicker.timestamp)

    const ticker: BookTicker = {
      type: 'book_ticker',
      symbol,
      exchange: 'bitflyer',

      askAmount: bitflyerTicker.best_ask_size,
      askPrice: bitflyerTicker.best_ask,

      bidPrice: bitflyerTicker.best_bid,
      bidAmount: bitflyerTicker.best_bid_size,
      timestamp,
      localTimestamp: localTimestamp
    }

    yield ticker
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
    channel: string
    message: {
      bids: BitflyerBookLevel[]
      asks: BitflyerBookLevel[]
    }
  }
}

type BitflyerTicker = {
  method: 'channelMessage'
  params: {
    channel: 'lightning_ticker_ETH_JPY'
    message: {
      product_code: 'ETH_JPY'
      state: 'RUNNING'
      timestamp: '2021-09-01T00:00:00.2115808Z'
      tick_id: 2830807
      best_bid: 376592.0
      best_ask: 376676.0
      best_bid_size: 0.01
      best_ask_size: 0.4
      total_bid_depth: 5234.4333389
      total_ask_depth: 1511.52678
      market_bid_size: 0.0
      market_ask_size: 0.0
      ltp: 376789.0
      volume: 37853.5120461
      volume_by_product: 37853.5120461
    }
  }
}
