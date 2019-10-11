import { MapperBase } from './mapper'
import { DataType, FilterForExchange, Trade, BookChange } from '../types'

export class BitflyerMapper extends MapperBase {
  public supportedDataTypes = ['trade', 'book_change'] as const

  private readonly _dataTypeChannelMapping: { [key in DataType]?: FilterForExchange['bitflyer']['channel'][] } = {
    book_change: ['lightning_board_snapshot', 'lightning_board'],
    trade: ['lightning_executions']
  }

  protected mapDataTypeAndSymbolsToFilters(dataType: DataType, symbols?: string[]) {
    const channels = this._dataTypeChannelMapping[dataType]!

    return channels.map(channel => {
      return {
        channel,
        symbols
      }
    })
  }

  protected detectDataType(message: BitflyerExecutions | BitflyerBoard): DataType | undefined {
    if (message.method !== 'channelMessage') {
      return
    }

    const channel = message.params.channel

    if (channel.startsWith('lightning_board')) {
      return 'book_change'
    }
    if (channel.startsWith('lightning_executions')) {
      return 'trade'
    }

    return
  }

  protected *mapTrades(bitflyerExecutions: BitflyerExecutions, localTimestamp: Date): IterableIterator<Trade> {
    const symbol = bitflyerExecutions.params.channel.replace('lightning_executions_', '')

    for (const execution of bitflyerExecutions.params.message) {
      yield {
        type: 'trade',
        symbol,
        exchange: this.exchange,
        id: String(execution.id),
        price: execution.price,
        amount: execution.size,
        side: execution.side === 'BUY' ? 'buy' : execution.side === 'SELL' ? 'sell' : 'unknown',
        timestamp: new Date(execution.exec_date),
        localTimestamp: localTimestamp
      }
    }
  }

  protected *mapOrderBookChanges(bitflyerBoard: BitflyerBoard, localTimestamp: Date): IterableIterator<BookChange> {
    const channel = bitflyerBoard.params.channel
    const isSnapshot = channel.startsWith('lightning_board_snapshot_')
    const symbol = isSnapshot ? channel.replace('lightning_board_snapshot_', '') : channel.replace('lightning_board_', '')

    yield {
      type: 'book_change',
      symbol,
      exchange: this.exchange,
      isSnapshot,
      bids: bitflyerBoard.params.message.bids.map(this._mapBookLevel),
      asks: bitflyerBoard.params.message.asks.map(this._mapBookLevel),
      timestamp: localTimestamp,
      localTimestamp
    }
  }

  private _mapBookLevel({ price, size }: BitflyerBookLevel) {
    return { price, amount: size }
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
