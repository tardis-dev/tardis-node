import { DataType, Quote, Ticker, Trade, L2Change, FilterForExchange } from '../types'
import { Mapper } from './mapper'

// https://docs.bitfinex.com/v2/docs/ws-general

export class BitfinexMapper extends Mapper {
  private readonly _channelIdToSymbolAndDataTypeMap: Map<number, { symbol: string; dataType: DataType }> = new Map()

  public getSupportedDataTypes(): DataType[] {
    return ['l2change', 'trade']
  }

  public reset() {
    this._channelIdToSymbolAndDataTypeMap.clear()
  }

  public getFiltersForDataTypeAndSymbols(dataType: DataType) {
    if (!this.getSupportedDataTypes().includes(dataType)) {
      throw new Error(`Bitfinex mapper does not support normalized ${dataType} data`)
    }
    // bitfinex does not support server side filtering
    return []
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
    if (message.event == 'subscribed') {
      const isBookP0Channel = message.channel == 'book' && message.prec == 'P0'
      if (isBookP0Channel) {
        this._channelIdToSymbolAndDataTypeMap.set(message.chanId, {
          symbol: message.pair,
          dataType: 'l2change'
        })
      }
      const isTradeChannel = message.channel == 'trades'
      if (isTradeChannel) {
        this._channelIdToSymbolAndDataTypeMap.set(message.chanId, {
          symbol: message.pair,
          dataType: 'trade'
        })
      }
      const isDerivStatusChannel = message.channel == 'status' && message.key && message.key.startsWith('deriv:')

      if (isDerivStatusChannel) {
        this._channelIdToSymbolAndDataTypeMap.set(message.chanId, {
          symbol: message.key!.replace('deriv:t', ''),
          dataType: 'ticker'
        })
      }
    }
    return
  }

  protected *mapTrades(message: BitfinexTrades, localTimestamp: Date): IterableIterator<Trade> {
    const matchingChannel = this._channelIdToSymbolAndDataTypeMap.get(message[0])
    // ignore if we don't have matching channel
    if (!matchingChannel) {
      return
    }
    // ignore heartbeats
    if (message[1] == 'hb') {
      return
    }
    // ignore snapshots
    if (message[1] != 'te') {
      return
    }

    const [id, timestamp, amount, price] = message[2]

    yield {
      type: 'trade',
      id: String(id),
      symbol: matchingChannel.symbol,
      price: price,
      amount: Math.abs(amount),
      side: amount < 0 ? 'sell' : 'buy',
      timestamp: new Date(timestamp),
      localTimestamp
    }
  }

  protected *mapL2OrderBookChanges(message: BitfinexBooks, localTimestamp: Date): IterableIterator<L2Change> {
    const matchingChannel = this._channelIdToSymbolAndDataTypeMap.get(message[0])
    // ignore if we don't have matching channel
    if (!matchingChannel) {
      return
    }
    // ignore heartbeats
    if (message[1] == 'hb') {
      return
    }

    const isSnapshot = Array.isArray(message[1][0])
    const bookLevels = (isSnapshot ? message[1] : [message[1]]) as BitfinexBookLevel[]

    const asks = bookLevels.filter(level => level[2] < 0)
    const bids = bookLevels.filter(level => level[2] > 0)

    yield {
      type: 'l2change',
      changeType: isSnapshot ? 'snapshot' : 'update',
      symbol: matchingChannel.symbol,
      bids: bids.map(this._mapBookLevel),
      asks: asks.map(this._mapBookLevel),
      timestamp: new Date(message[3]),
      localTimestamp
    }
  }

  protected *mapTickers(message: BitfinexStatusMessage, localTimestamp: Date): IterableIterator<Ticker> {
    const matchingChannel = this._channelIdToSymbolAndDataTypeMap.get(message[0])
    // ignore if we don't have matching channel
    if (!matchingChannel) {
      return
    }

    // ignore heartbeats
    if (message[1] == 'hb') {
      return
    }

    // https://docs.bitfinex.com/v2/reference#ws-public-status
    const fundingRate = message[1][11]
    const indexPrice = message[1][3]
    const lastPrice = message[1][2]!

    yield {
      type: 'ticker',
      symbol: matchingChannel.symbol,
      lastPrice,
      fundingRate,
      indexPrice,
      timestamp: new Date(message[3]),
      localTimestamp
    }
  }

  protected mapQuotes(): IterableIterator<Quote> {
    throw new Error('normalized quotes not supported.')
  }

  private _mapBookLevel(level: BitfinexBookLevel) {
    const [price, count, bitfinexAmount] = level
    const amount = count == 0 ? 0 : Math.abs(bitfinexAmount)

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
  public getSupportedDataTypes(): DataType[] {
    return ['l2change', 'trade', 'ticker']
  }
}
