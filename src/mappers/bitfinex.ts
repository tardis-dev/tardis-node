import { Mapper, DataType, Quote, Ticker, Trade, L2Change } from './mapper'
import { FilterForExchange } from '../consts'

// https://docs.bitfinex.com/v2/docs/ws-general

export class BitfinexMapper extends Mapper {
  private readonly _channelIdToSymbolAndChannelLevelMap: Map<
    number,
    { symbol: string; channel: FilterForExchange['bitfinex']['channel'] }
  > = new Map()

  private readonly _channelDataTypeMapping: { [key in FilterForExchange['bitfinex']['channel']]: DataType } = {
    book: 'l2change',
    trades: 'trade'
  }

  public getSupportedDataTypes(): DataType[] {
    return ['l2change', 'trade']
  }

  public reset() {
    this._channelIdToSymbolAndChannelLevelMap.clear()
  }

  public getFiltersForDataTypeAndSymbols(dataType: DataType) {
    if (!this.getSupportedDataTypes().includes(dataType)) {
      throw new Error(`Bitfinex mapper does not support normalized ${dataType} data`)
    }
    // bitfinex does not support server side filtering
    return []
  }

  protected getDataType(message: BitfinexMessage): DataType | undefined {
    // non sub messages are provided as arrays
    if (Array.isArray(message)) {
      // we need to find matching channel for channel id
      const matchingChannel = this._channelIdToSymbolAndChannelLevelMap.get(message[0])
      if (matchingChannel) {
        return this._channelDataTypeMapping[matchingChannel.channel]
      }
      return
    }

    // store mapping between channel id and symbols and channel
    if (message.event == 'subscribed') {
      const isBookP0Channel = message.channel == 'book' && message.prec == 'P0'
      const isTradeChannel = message.channel == 'trades'
      if (isBookP0Channel || isTradeChannel) {
        this._channelIdToSymbolAndChannelLevelMap.set(message.chanId, {
          symbol: message.pair,
          channel: message.channel
        })
      }
    }
    return
  }

  protected *mapTrades(message: BitfinexTrades, localTimestamp: Date): IterableIterator<Trade> {
    const matchingChannel = this._channelIdToSymbolAndChannelLevelMap.get(message[0])
    // ignore if we don't have matching channel
    if (!matchingChannel) {
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
    const matchingChannel = this._channelIdToSymbolAndChannelLevelMap.get(message[0])
    // ignore if we don't have matching channel
    if (!matchingChannel) {
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

  protected mapTickers(): IterableIterator<Ticker> {
    throw new Error('normalized tickers not supported')
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
      channel: FilterForExchange['bitfinex']['channel']
      chanId: number
      pair: string
      prec: string
    }
  | Array<any>

type BitfinexTrades = [number, 'te' | any[], [number, number, number, number]]
type BitfinexBookLevel = [number, number, number]
type BitfinexBooks = [number, BitfinexBookLevel | BitfinexBookLevel[], number, number]
