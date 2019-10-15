import { DataType, DerivativeTicker, Trade, BookChange, FilterForExchange } from '../types'
import { MapperBase } from './mapper'

// https://docs.bitfinex.com/v2/docs/ws-general

export class BitfinexMapper extends MapperBase {
  public supportedDataTypes: DataType[] = ['trade', 'book_change']

  private readonly _dataTypeChannelMapping: { [key in DataType]: string } = {
    book_change: 'book',
    trade: 'trades',
    derivative_ticker: 'status'
  }

  private readonly _channelIdToSymbolAndDataTypeMap: Map<number, { symbol: string; dataType: DataType }> = new Map()

  protected mapDataTypeAndSymbolsToFilters(dataType: DataType, symbols?: string[]) {
    const channel = this._dataTypeChannelMapping[dataType]

    return [
      {
        channel,
        symbols
      }
    ]
  }

  protected detectDataType(message: BitfinexMessage): DataType | undefined {
    // non sub messages are provided as arrays
    if (Array.isArray(message)) {
      // we need to find matching channel for channel id
      const matchingChannel = this._channelIdToSymbolAndDataTypeMap.get(message[0])
      if (matchingChannel) {
        return matchingChannel.dataType
      }
      return
    }

    // store mapping between channel id and symbols and channel
    if (message.event === 'subscribed') {
      const isBookP0Channel = message.channel === 'book' && message.prec === 'P0'
      if (isBookP0Channel) {
        this._channelIdToSymbolAndDataTypeMap.set(message.chanId, {
          symbol: message.pair,
          dataType: 'book_change'
        })
      }
      const isTradeChannel = message.channel === 'trades'
      if (isTradeChannel) {
        this._channelIdToSymbolAndDataTypeMap.set(message.chanId, {
          symbol: message.pair,
          dataType: 'trade'
        })
      }
      const isDerivStatusChannel = message.channel === 'status' && message.key && message.key.startsWith('deriv:')

      if (isDerivStatusChannel) {
        this._channelIdToSymbolAndDataTypeMap.set(message.chanId, {
          symbol: message.key!.replace('deriv:t', ''),
          dataType: 'derivative_ticker'
        })
      }
    }

    return
  }

  protected *mapTrades(message: BitfinexTrades, localTimestamp: Date): IterableIterator<Trade> {
    const matchingChannel = this._channelIdToSymbolAndDataTypeMap.get(message[0])
    // ignore if we don't have matching channel
    if (matchingChannel === undefined) {
      return
    }

    // ignore heartbeats
    if (message[1] === 'hb') {
      return
    }
    // ignore snapshots
    if (message[1] !== 'te') {
      return
    }

    const [id, timestamp, amount, price] = message[2]

    yield {
      type: 'trade',
      symbol: matchingChannel.symbol,
      exchange: this.exchange,
      id: String(id),
      price,
      amount: Math.abs(amount),
      side: amount < 0 ? 'sell' : 'buy',
      timestamp: new Date(timestamp),
      localTimestamp: localTimestamp
    }
  }

  protected *mapOrderBookChanges(message: BitfinexBooks, localTimestamp: Date): IterableIterator<BookChange> {
    const matchingChannel = this._channelIdToSymbolAndDataTypeMap.get(message[0])
    // ignore if we don't have matching channel
    if (matchingChannel === undefined) {
      return
    }
    // ignore heartbeats
    if (message[1] === 'hb') {
      return
    }

    const isSnapshot = Array.isArray(message[1][0])
    const bookLevels = (isSnapshot ? message[1] : [message[1]]) as BitfinexBookLevel[]

    const asks = bookLevels.filter(level => level[2] < 0)
    const bids = bookLevels.filter(level => level[2] > 0)

    yield {
      type: 'book_change',
      symbol: matchingChannel.symbol,
      exchange: this.exchange,
      isSnapshot,

      bids: bids.map(this._mapBookLevel),
      asks: asks.map(this._mapBookLevel),
      timestamp: new Date(message[3]),
      localTimestamp: localTimestamp
    }
  }

  protected *mapDerivativeTickerInfo(message: BitfinexStatusMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const matchingChannel = this._channelIdToSymbolAndDataTypeMap.get(message[0])

    // ignore if we don't have matching channel
    if (matchingChannel === undefined) {
      return
    }

    // ignore heartbeats
    if (message[1] === 'hb') {
      return
    }
    const statusInfo = message[1]
    // https://docs.bitfinex.com/v2/reference#ws-public-status

    const fundingRate = statusInfo[11]
    const indexPrice = statusInfo[3]
    const lastPrice = statusInfo[2]
    const markPrice = statusInfo[14]

    const pendingTickerInfo = this.getPendingTickerInfo(matchingChannel.symbol)

    pendingTickerInfo.updateFundingRate(fundingRate)
    pendingTickerInfo.updateIndexPrice(indexPrice)
    pendingTickerInfo.updateLastPrice(lastPrice)
    pendingTickerInfo.updateMarkPrice(markPrice)

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(new Date(message[3]), localTimestamp)
    }
  }

  private _mapBookLevel(level: BitfinexBookLevel) {
    const [price, count, bitfinexAmount] = level
    const amount = count === 0 ? 0 : Math.abs(bitfinexAmount)

    return { price, amount }
  }
}

type BitfinexMessage =
  | {
      event: 'subscribed'
      channel: FilterForExchange['bitfinex-derivatives']['channel']
      chanId: number
      pair: string
      prec: string
      key?: string
    }
  | Array<any>

type BitfinexHeartbeat = [number, 'hb']
type BitfinexTrades = [number, 'te' | any[], [number, number, number, number]] | BitfinexHeartbeat
type BitfinexBookLevel = [number, number, number]
type BitfinexBooks = [number, BitfinexBookLevel | BitfinexBookLevel[], number, number] | BitfinexHeartbeat

type BitfinexStatusMessage = [number, (number | undefined)[], number, number] | BitfinexHeartbeat

// bitfinex derivatives mapper additionaly can get ticker info from status channel (funding, index price etc)
export class BitfinexDerivativesMapper extends BitfinexMapper {
  public supportedDataTypes: DataType[] = ['trade', 'book_change', 'derivative_ticker']
}
