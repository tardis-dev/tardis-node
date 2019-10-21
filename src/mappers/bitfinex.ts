import { DerivativeTicker, Trade, BookChange, FilterForExchange, Exchange } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://docs.bitfinex.com/v2/docs/ws-general

export class BitfinexTradesMapper implements Mapper<'bitfinex' | 'bitfinex-derivatives', Trade> {
  private readonly _channelIdToSymbolMap: Map<number, string> = new Map()

  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: BitfinexMessage) {
    // non sub messages are provided as arrays
    if (Array.isArray(message)) {
      // we need to have matching symbol for channel id

      return this._channelIdToSymbolMap.get(message[0]) !== undefined
    }

    // store mapping between channel id and symbols
    if (message.event === 'subscribed') {
      const isTradeChannel = message.channel === 'trades'
      if (isTradeChannel) {
        this._channelIdToSymbolMap.set(message.chanId, message.pair)
      }
    }

    return false
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'trades',
        symbols
      } as const
    ]
  }

  *map(message: BitfinexTrades, localTimestamp: Date) {
    const symbol = this._channelIdToSymbolMap.get(message[0])
    // ignore if we don't have matching symbol
    if (symbol === undefined) {
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

    const trade: Trade = {
      type: 'trade',
      symbol,
      exchange: this._exchange,
      id: String(id),
      price,
      amount: Math.abs(amount),
      side: amount < 0 ? 'sell' : 'buy',
      timestamp: new Date(timestamp),
      localTimestamp: localTimestamp
    }

    yield trade
  }
}

export class BitfinexBookChangeMapper implements Mapper<'bitfinex' | 'bitfinex-derivatives', BookChange> {
  private readonly _channelIdToSymbolMap: Map<number, string> = new Map()

  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: BitfinexMessage) {
    // non sub messages are provided as arrays
    if (Array.isArray(message)) {
      // we need to have matching symbol for channel id

      return this._channelIdToSymbolMap.get(message[0]) !== undefined
    }

    // store mapping between channel id and symbols
    if (message.event === 'subscribed') {
      const isBookP0Channel = message.channel === 'book' && message.prec === 'P0'
      if (isBookP0Channel) {
        this._channelIdToSymbolMap.set(message.chanId, message.pair)
      }
    }

    return false
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'book',
        symbols
      } as const
    ]
  }

  *map(message: BitfinexBooks, localTimestamp: Date) {
    const symbol = this._channelIdToSymbolMap.get(message[0])
    // ignore if we don't have matching symbol
    if (symbol === undefined) {
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

    const bookChange: BookChange = {
      type: 'book_change',
      symbol,
      exchange: this._exchange,
      isSnapshot,

      bids: bids.map(this._mapBookLevel),
      asks: asks.map(this._mapBookLevel),
      timestamp: new Date(message[3]),
      localTimestamp: localTimestamp
    }

    yield bookChange
  }

  private _mapBookLevel(level: BitfinexBookLevel) {
    const [price, count, bitfinexAmount] = level
    const amount = count === 0 ? 0 : Math.abs(bitfinexAmount)

    return { price, amount }
  }
}

export class BitfinexDerivativeTickerMapper implements Mapper<'bitfinex-derivatives', DerivativeTicker> {
  private readonly _channelIdToSymbolMap: Map<number, string> = new Map()
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: BitfinexMessage) {
    // non sub messages are provided as arrays
    if (Array.isArray(message)) {
      // we need to have matching symbol for channel id

      return this._channelIdToSymbolMap.get(message[0]) !== undefined
    }

    // store mapping between channel id and symbols
    if (message.event === 'subscribed') {
      const isDerivStatusChannel = message.channel === 'status' && message.key && message.key.startsWith('deriv:')

      if (isDerivStatusChannel) {
        this._channelIdToSymbolMap.set(message.chanId, message.key!.replace('deriv:t', ''))
      }
    }

    return false
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: 'status',
        symbols
      } as const
    ]
  }

  *map(message: BitfinexStatusMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const symbol = this._channelIdToSymbolMap.get(message[0])

    // ignore if we don't have matching symbol
    if (symbol === undefined) {
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

    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(symbol, 'bitfinex-derivatives')

    pendingTickerInfo.updateFundingRate(fundingRate)
    pendingTickerInfo.updateIndexPrice(indexPrice)
    pendingTickerInfo.updateLastPrice(lastPrice)
    pendingTickerInfo.updateMarkPrice(markPrice)

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(new Date(message[3]), localTimestamp)
    }
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
