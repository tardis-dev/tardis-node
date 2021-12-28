import { upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, DerivativeTicker, Exchange, FilterForExchange, Liquidation, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://docs.bitfinex.com/v2/docs/ws-general

export class BitfinexTradesMapper implements Mapper<'bitfinex' | 'bitfinex-derivatives', Trade> {
  private readonly _channelIdToSymbolMap: Map<number, string> = new Map()

  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: BitfinexMessage) {
    // non sub messages are provided as arrays
    if (Array.isArray(message)) {
      // first test if message itself provides channel name and if so if it's trades
      const channelName = message[message.length - 2]
      if (typeof channelName === 'string') {
        return channelName === 'trades'
      }

      // otherwise use channel to id mapping
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
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trades',
        symbols
      } as const
    ]
  }

  *map(message: BitfinexTrades, localTimestamp: Date) {
    const symbolFromMessage = message[message.length - 1]
    const symbol = typeof symbolFromMessage === 'string' ? symbolFromMessage : this._channelIdToSymbolMap.get(message[0])

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
      // first test if message itself provides channel name and if so if it's a book
      const channelName = message[message.length - 2]
      if (typeof channelName === 'string') {
        return channelName === 'book'
      }

      // otherwise use channel to id mapping
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
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'book',
        symbols
      } as const
    ]
  }

  *map(message: BitfinexBooks, localTimestamp: Date) {
    const symbolFromMessage = message[message.length - 1]
    const symbol = typeof symbolFromMessage === 'string' ? symbolFromMessage : this._channelIdToSymbolMap.get(message[0])

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

    const asks = bookLevels.filter((level) => level[2] < 0)
    const bids = bookLevels.filter((level) => level[2] > 0)

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
      // first test if message itself provides channel name and if so if it's a status
      const channelName = message[message.length - 2]
      if (typeof channelName === 'string') {
        return channelName === 'status'
      }

      // otherwise use channel to id mapping
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
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'status',
        symbols
      } as const
    ]
  }

  *map(message: BitfinexStatusMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const symbolFromMessage = message[message.length - 1]
    const symbol = typeof symbolFromMessage === 'string' ? symbolFromMessage : this._channelIdToSymbolMap.get(message[0])

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
    const openInterest = statusInfo[17]
    const nextFundingTimestamp = statusInfo[7]
    const predictedFundingRate = statusInfo[8]

    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(symbol, 'bitfinex-derivatives')

    pendingTickerInfo.updateFundingRate(fundingRate)
    pendingTickerInfo.updateFundingTimestamp(nextFundingTimestamp !== undefined ? new Date(nextFundingTimestamp) : undefined)
    pendingTickerInfo.updatePredictedFundingRate(predictedFundingRate)

    pendingTickerInfo.updateIndexPrice(indexPrice)
    pendingTickerInfo.updateLastPrice(lastPrice)
    pendingTickerInfo.updateMarkPrice(markPrice)
    pendingTickerInfo.updateOpenInterest(openInterest)

    pendingTickerInfo.updateTimestamp(new Date(message[3]))

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

export class BitfinexLiquidationsMapper implements Mapper<'bitfinex-derivatives', Liquidation> {
  private _liquidationsChannelId: number | undefined = undefined

  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: BitfinexMessage) {
    // non sub messages are provided as arrays
    if (Array.isArray(message)) {
      // first test if message itself provides channel name and if so if it's liquidations
      const channelName = message[message.length - 2]
      if (typeof channelName === 'string') {
        return channelName === 'liquidations'
      }

      // otherwise use channel id
      return this._liquidationsChannelId === message[0]
    }

    // store liquidation channel id
    if (message.event === 'subscribed') {
      const isLiquidationsChannel = message.channel === 'status' && message.key === 'liq:global'
      if (isLiquidationsChannel) {
        this._liquidationsChannelId = message.chanId
      }
    }

    return false
  }

  getFilters() {
    // liquidations channel is global, not per symbol
    return [
      {
        channel: 'liquidations'
      } as const
    ]
  }

  *map(message: BitfinexLiquidation, localTimestamp: Date) {
    // ignore heartbeats
    if (message[1] === 'hb') {
      return
    }

    if (!message[1]) {
      return
    }
    // see https://docs.bitfinex.com/reference#ws-public-status
    for (let bitfinexLiquidation of message[1]) {
      const isInitialLiquidationTrigger = bitfinexLiquidation[8] === 0
      // process only initial liquidation triggers not subsequent 'matches', assumption here is that
      // there's only single initial liquidation trigger but there can be multiple matches for single liquidation
      if (isInitialLiquidationTrigger) {
        const id = String(bitfinexLiquidation[1])
        const timestamp = new Date(bitfinexLiquidation[2])
        const symbol = bitfinexLiquidation[4].replace('t', '')
        const price = bitfinexLiquidation[6]
        const amount = bitfinexLiquidation[5]

        const liquidation: Liquidation = {
          type: 'liquidation',
          symbol,
          exchange: this._exchange,
          id,
          price,
          amount: Math.abs(amount),
          side: amount < 0 ? 'buy' : 'sell',
          timestamp,
          localTimestamp: localTimestamp
        }

        yield liquidation
      }
    }
  }
}

export class BitfinexBookTickerMapper implements Mapper<'bitfinex' | 'bitfinex-derivatives', BookTicker> {
  private readonly _channelIdToSymbolMap: Map<number, string> = new Map()

  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: BitfinexMessage) {
    // non sub messages are provided as arrays
    if (Array.isArray(message)) {
      // first test if message itself provides channel name and if so if it's trades
      const channelName = message[message.length - 2]
      if (typeof channelName === 'string') {
        return channelName === 'ticker'
      }

      // otherwise use channel to id mapping
      return this._channelIdToSymbolMap.get(message[0]) !== undefined
    }

    // store mapping between channel id and symbols
    if (message.event === 'subscribed') {
      const isTicker = message.channel === 'ticker' && message.pair !== undefined
      if (isTicker) {
        this._channelIdToSymbolMap.set(message.chanId, message.pair)
      }
    }

    return false
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'ticker',
        symbols
      } as const
    ]
  }

  *map(message: BitfinexTicker, localTimestamp: Date) {
    const symbolFromMessage = message[message.length - 1]
    const symbol = typeof symbolFromMessage === 'string' ? symbolFromMessage : this._channelIdToSymbolMap.get(message[0])

    // ignore if we don't have matching symbol
    if (symbol === undefined) {
      return
    }

    // ignore heartbeats
    if (message[1] === 'hb') {
      return
    }
    // ignore funding tickers

    if (message[1].length > 10) {
      return
    }

    const [bidPrice, bidAmount, askPrice, askAmount, _, __] = message[1]

    const ticker: BookTicker = {
      type: 'book_ticker',
      symbol,
      exchange: this._exchange,
      askAmount,
      askPrice,
      bidPrice,
      bidAmount,
      timestamp: new Date(message[3]),
      localTimestamp: localTimestamp
    }

    yield ticker
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

type BitfinexLiquidation =
  | [number, ['pos', number, number, null, string, number, number, null, number, number, null, number][]]
  | BitfinexHeartbeat

type BitfinexTicker =
  | [
      CHANNEL_ID: number,
      ITEMS: [
        BID: number,
        BID_SIZE: number,
        ASK: number,
        ASK_SIZE: number,
        DAILY_CHANGE: number,
        DAILY_CHANGE_RELATIVE: number,
        LAST_PRICE: number,
        VOLUME: number,
        HIGH: number,
        LOW: number
      ],
      SEQ_ID: number,
      TIMESTAMP: number
    ]
  | BitfinexHeartbeat
