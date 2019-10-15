import { DataType, Trade, BookChange, FilterForExchange } from '../types'
import { MapperBase } from './mapper'

// https://www.kraken.com/features/websocket-api

export class KrakenMapper extends MapperBase {
  public supportedDataTypes: DataType[] = ['trade', 'book_change']

  private readonly _dataTypeChannelMapping: { [key in DataType]?: FilterForExchange['kraken']['channel'] } = {
    book_change: 'book',
    trade: 'trade'
  }

  protected mapDataTypeAndSymbolsToFilters(dataType: DataType, symbols?: string[]) {
    const channel = this._dataTypeChannelMapping[dataType]!

    return [
      {
        channel,
        symbols
      }
    ]
  }

  protected detectDataType(message: KrakenTrades | KrakenBookSnapshot | KrakenBookUpdate): DataType | undefined {
    if (!Array.isArray(message)) {
      return
    }

    const channel = message[message.length - 2] as string
    if (channel === 'trade') {
      return 'trade'
    }
    if (channel.startsWith('book')) {
      return 'book_change'
    }

    return
  }

  protected *mapTrades(message: KrakenTrades, localTimestamp: Date): IterableIterator<Trade> {
    const [_, trades, __, symbol] = message
    for (const [price, amount, time, side] of trades) {
      yield {
        type: 'trade',
        symbol,
        exchange: this.exchange,
        id: undefined,
        price: Number(price),
        amount: Number(amount),
        side: side === 'b' ? 'buy' : 'sell',
        timestamp: new Date(Number(time) * 1000),
        localTimestamp: localTimestamp
      }
    }
  }

  protected *mapOrderBookChanges(message: KrakenBookSnapshot | KrakenBookUpdate, localTimestamp: Date): IterableIterator<BookChange> {
    if ('as' in message[1]) {
      // we've got snapshot message
      const [_, { as, bs }, __, symbol] = message

      yield {
        type: 'book_change',
        symbol: symbol,
        exchange: this.exchange,
        isSnapshot: true,

        bids: bs.map(this._mapBookLevel),
        asks: as.map(this._mapBookLevel),
        timestamp: localTimestamp,
        localTimestamp: localTimestamp
      }
    } else {
      // we've got update message
      const symbol = message[message.length - 1] as string
      const asks = 'a' in message[1] ? message[1].a : []
      const bids = 'b' in message[1] ? message[1].b : typeof message[2] !== 'string' && 'b' in message[2] ? message[2].b : []

      yield {
        type: 'book_change',
        symbol,
        exchange: this.exchange,
        isSnapshot: false,

        bids: bids.map(this._mapBookLevel),
        asks: asks.map(this._mapBookLevel),
        timestamp: localTimestamp,
        localTimestamp: localTimestamp
      }
    }
  }

  private _mapBookLevel(level: KrakenBookLevel) {
    const [price, amount] = level

    return { price: Number(price), amount: Number(amount) }
  }
}

type KrakenTrades = [number, [string, string, string, 's' | 'b', string, string][], string, string]
type KrakenBookLevel = [string, string, string]
type KrakenBookSnapshot = [
  number,
  {
    as: KrakenBookLevel[]
    bs: KrakenBookLevel[]
  },
  string,
  string
]

type KrakenBookUpdate =
  | [
      number,


        | {
            a: KrakenBookLevel[]
          }
        | {
            b: KrakenBookLevel[]
          },
      string,
      string
    ]
  | [
      number,

      {
        a: KrakenBookLevel[]
      },
      {
        b: KrakenBookLevel[]
      },
      string,
      string
    ]
