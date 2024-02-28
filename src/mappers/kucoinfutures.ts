import { debug } from '../debug'
import { asNumberIfValid, CircularBuffer, upperCaseSymbols } from '../handy'
import { BookChange, BookTicker, DerivativeTicker, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

export class KucoinFuturesTradesMapper implements Mapper<'kucoin-futures', Trade> {
  canHandle(message: KucoinFuturesTradeMessage) {
    return message.type === 'message' && message.topic.startsWith('/contractMarket/execution')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'contractMarket/execution',
        symbols
      } as const
    ]
  }

  *map(message: KucoinFuturesTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    const kucoinTrade = message.data

    const timestamp = new Date(kucoinTrade.ts / 1000000)

    yield {
      type: 'trade',
      symbol: kucoinTrade.symbol,
      exchange: 'kucoin-futures',
      id: kucoinTrade.tradeId,
      price: Number(kucoinTrade.price),
      amount: Number(kucoinTrade.size),
      side: kucoinTrade.side === 'sell' ? 'sell' : 'buy',
      timestamp,
      localTimestamp
    }
  }
}

export class KucoinFuturesBookChangeMapper implements Mapper<'kucoin-futures', BookChange> {
  protected readonly symbolToDepthInfoMapping: {
    [key: string]: LocalDepthInfo
  } = {}

  constructor(private readonly ignoreBookSnapshotOverlapError: boolean) {}

  canHandle(message: KucoinFuturesLevel2SnapshotMessage | KucoinFuturesLevel2UpdateMessage) {
    return message.type === 'message' && message.topic.startsWith('/contractMarket/level2')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'contractMarket/level2',
        symbols
      } as const,
      {
        channel: 'contractMarket/level2Snapshot',
        symbols
      } as const
    ]
  }

  *map(message: KucoinFuturesLevel2SnapshotMessage | KucoinFuturesLevel2UpdateMessage, localTimestamp: Date) {
    const symbol = message.topic.split(':')[1]

    if (this.symbolToDepthInfoMapping[symbol] === undefined) {
      this.symbolToDepthInfoMapping[symbol] = {
        bufferedUpdates: new CircularBuffer<KucoinFuturesLevel2UpdateMessage>(2000)
      }
    }

    const symbolDepthInfo = this.symbolToDepthInfoMapping[symbol]
    const snapshotAlreadyProcessed = symbolDepthInfo.snapshotProcessed

    // first check if received message is snapshot and process it as such if it is
    if (message.subject === 'level2Snapshot') {
      // if we've already received 'manual' snapshot, ignore if there is another one
      if (snapshotAlreadyProcessed) {
        return
      }
      // produce snapshot book_change
      const kucoinSnapshotData = message.data

      if (!message.data) {
        return
      }

      if (!kucoinSnapshotData.asks) {
        kucoinSnapshotData.asks = []
      }
      if (!kucoinSnapshotData.bids) {
        kucoinSnapshotData.bids = []
      }

      //  mark given symbol depth info that has snapshot processed
      symbolDepthInfo.lastUpdateId = Number(kucoinSnapshotData.sequence)
      symbolDepthInfo.snapshotProcessed = true

      // if there were any depth updates buffered, let's process those by adding to or updating the initial snapshot
      for (const update of symbolDepthInfo.bufferedUpdates.items()) {
        const bookChange = this.mapBookDepthUpdate(update, localTimestamp)

        if (bookChange !== undefined) {
          const mappedChange = this.mapChange(update.data.change)
          if (mappedChange.price == 0) {
            continue
          }

          const matchingSide = mappedChange.isBid ? kucoinSnapshotData.bids : kucoinSnapshotData.asks
          const matchingLevel = matchingSide.find((b) => b[0] === mappedChange.price)

          if (matchingLevel !== undefined) {
            // remove empty level from snapshot
            if (mappedChange.amount === 0) {
              const index = matchingSide.findIndex((b) => b[0] === mappedChange.price)
              if (index > -1) {
                matchingSide.splice(index, 1)
              }
            } else {
              matchingLevel[1] = mappedChange.amount
            }
          } else if (mappedChange.amount != 0) {
            matchingSide.push([mappedChange.price, mappedChange.amount])
          }
        }
      }

      // remove all buffered updates
      symbolDepthInfo.bufferedUpdates.clear()

      const bookChange: BookChange = {
        type: 'book_change',
        symbol,
        exchange: 'kucoin-futures',
        isSnapshot: true,
        bids: kucoinSnapshotData.bids.map(this.mapBookLevel),
        asks: kucoinSnapshotData.asks.map(this.mapBookLevel),
        timestamp: localTimestamp,
        localTimestamp
      }

      yield bookChange
    } else if (snapshotAlreadyProcessed) {
      // snapshot was already processed let's map the message as normal book_change
      const bookChange = this.mapBookDepthUpdate(message, localTimestamp)
      if (bookChange !== undefined) {
        yield bookChange
      }
    } else {
      symbolDepthInfo.bufferedUpdates.append(message)
    }
  }

  protected mapBookDepthUpdate(l2UpdateMessage: KucoinFuturesLevel2UpdateMessage, localTimestamp: Date): BookChange | undefined {
    // we can safely assume here that depthContext and lastUpdateId aren't null here as this is method only works
    // when we've already processed the snapshot
    const symbol = l2UpdateMessage.topic.split(':')[1]
    const depthContext = this.symbolToDepthInfoMapping[symbol]!
    const lastUpdateId = depthContext.lastUpdateId!

    // Drop any event where sequence is <= lastUpdateId in the snapshot
    if (l2UpdateMessage.data.sequence <= lastUpdateId) {
      return
    }

    // The first processed event should have sequence>lastUpdateId
    if (!depthContext.validatedFirstUpdate) {
      // if there is new instrument added it can have empty book at first and that's normal
      const bookSnapshotIsEmpty = lastUpdateId == -1 || lastUpdateId == 0

      if (l2UpdateMessage.data.sequence === lastUpdateId + 1 || bookSnapshotIsEmpty) {
        depthContext.validatedFirstUpdate = true
      } else {
        const message = `Book depth snapshot has no overlap with first update, update ${JSON.stringify(
          l2UpdateMessage
        )}, lastUpdateId: ${lastUpdateId}, exchange kucoin-futures`
        if (this.ignoreBookSnapshotOverlapError) {
          depthContext.validatedFirstUpdate = true
          debug(message)
        } else {
          throw new Error(message)
        }
      }
    }

    const change = this.mapChange(l2UpdateMessage.data.change)

    return {
      type: 'book_change',
      symbol: symbol,
      exchange: 'kucoin-futures',
      isSnapshot: false,
      bids: change.isBid
        ? [
            {
              price: change.price,
              amount: change.amount
            }
          ]
        : [],
      asks:
        change.isBid === false
          ? [
              {
                price: change.price,
                amount: change.amount
              }
            ]
          : [],
      timestamp: new Date(l2UpdateMessage.data.timestamp),
      localTimestamp: localTimestamp
    }
  }

  private mapBookLevel(level: [number, number]) {
    return { price: level[0], amount: level[1] }
  }

  private mapChange(change: string) {
    const parts = change.split(',')
    const isBid = parts[1] === 'buy'
    const price = Number(parts[0])
    const amount = Number(parts[2])

    return { isBid, price, amount }
  }
}

export class KucoinFuturesBookTickerMapper implements Mapper<'kucoin-futures', BookTicker> {
  canHandle(message: KucoinFuturesTickerMessage) {
    return message.type === 'message' && message.topic.startsWith('/contractMarket/tickerV2')
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'contractMarket/tickerV2',
        symbols
      } as const
    ]
  }

  *map(message: KucoinFuturesTickerMessage, localTimestamp: Date) {
    const symbol = message.topic.split(':')[1]

    const bookTicker: BookTicker = {
      type: 'book_ticker',
      symbol,
      exchange: 'kucoin-futures',
      askAmount: message.data.bestAskSize !== undefined && message.data.bestAskSize !== null ? message.data.bestAskSize : undefined,
      askPrice:
        message.data.bestAskPrice !== undefined && message.data.bestAskPrice !== null ? Number(message.data.bestAskPrice) : undefined,

      bidPrice:
        message.data.bestBidPrice !== undefined && message.data.bestBidPrice !== null ? Number(message.data.bestBidPrice) : undefined,

      bidAmount: message.data.bestBidSize !== undefined && message.data.bestBidSize !== null ? message.data.bestBidSize : undefined,
      timestamp: new Date(message.data.ts / 1000000),
      localTimestamp: localTimestamp
    }

    yield bookTicker
  }
}

export class KucoinFuturesDerivativeTickerMapper implements Mapper<'kucoin-futures', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()
  private readonly _lastPrices = new Map<string, number>()
  private readonly _openInterests = new Map<string, number>()

  canHandle(message: KucoinFuturesTickerMessage) {
    return (
      message.type === 'message' &&
      (message.topic.startsWith('/contract/instrument') ||
        message.topic.startsWith('/contractMarket/execution') ||
        message.topic.startsWith('/contract/details'))
    )
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)
    return [
      {
        channel: 'contract/instrument',
        symbols
      } as const,
      {
        channel: 'contractMarket/execution',
        symbols
      } as const,
      {
        channel: 'contract/details',
        symbols
      } as const
    ]
  }

  *map(message: KucoinFuturesInstrumentMessage | KucoinFuturesTradeMessage, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const symbol = message.topic.split(':')[1]

    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(symbol, 'kucoin-futures')

    if (message.subject === 'match') {
      this._lastPrices.set(symbol, Number(message.data.price))
      return
    }

    if (message.subject === 'contractDetails') {
      const openInterestValue = asNumberIfValid(message.data.openInterest)
      if (openInterestValue === undefined) {
        return
      }

      this._openInterests.set(symbol, openInterestValue)
      return
    }
    const lastPrice = this._lastPrices.get(symbol)
    const openInterest = this._openInterests.get(symbol)

    if (message.subject === 'mark.index.price') {
      pendingTickerInfo.updateIndexPrice(message.data.indexPrice)
      pendingTickerInfo.updateMarkPrice(message.data.markPrice)
    }

    if (message.subject === 'funding.rate') {
      pendingTickerInfo.updateTimestamp(new Date(message.data.timestamp))
      pendingTickerInfo.updateFundingRate(message.data.fundingRate)
    }

    if (lastPrice !== undefined) {
      pendingTickerInfo.updateLastPrice(lastPrice)
    }

    if (openInterest !== undefined) {
      pendingTickerInfo.updateOpenInterest(openInterest)
    }

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

type KucoinFuturesTradeMessage = {
  topic: '/contractMarket/execution:COMPUSDTM'
  type: 'message'
  subject: 'match'
  sn: 1694749771273
  data: {
    symbol: 'COMPUSDTM'
    sequence: 1694749771273
    makerUserId: '64b1a612d570b900017b7281'
    side: 'buy' | 'sell'
    size: 102
    price: '57.75'
    takerOrderId: '137974138051522560'
    takerUserId: '61945720862a310001d6581e'
    makerOrderId: '137974082376310784'
    tradeId: '1694749771273'
    ts: 1705708799996000000
  }
}

type LocalDepthInfo = {
  bufferedUpdates: CircularBuffer<KucoinFuturesLevel2UpdateMessage>
  snapshotProcessed?: boolean
  lastUpdateId?: number
  validatedFirstUpdate?: boolean
}

type KucoinFuturesLevel2SnapshotMessage = {
  type: 'message'
  generated: true
  topic: '/contractMarket/level2Snapshot:C98USDTM'
  subject: 'level2Snapshot'
  code: '200000'
  data: {
    sequence: 1694868048360
    symbol: 'C98USDTM'
    bids: [number, number][]
    asks: [number, number][]
    ts: 1705881597161000000
  }
}

type KucoinFuturesLevel2UpdateMessage = {
  topic: '/contractMarket/level2:C98USDTM'
  type: 'message'
  subject: 'level2'
  sn: 1694868048361
  data: { sequence: 1694868048361; change: '0.2353,buy,146'; timestamp: 1705881600096 }
}

type KucoinFuturesTickerMessage = {
  topic: '/contractMarket/tickerV2:BCHUSDTM'
  type: 'message'
  subject: 'tickerV2'
  sn: 1695158749093
  data: {
    symbol: 'BCHUSDTM'
    sequence: 1695158749093
    bestBidSize: 480
    bestBidPrice: '236.76'
    bestAskPrice: '236.77'
    bestAskSize: 126
    ts: 1705708800078000000
  }
}

type KucoinFuturesInstrumentMessage =
  | {
      topic: '/contract/instrument:ENSUSDTM'
      type: 'message'
      subject: 'funding.rate'
      data: { granularity: 60000; fundingRate: 0.000053; timestamp: 1705708800000 }
    }
  | {
      topic: '/contract/instrument:XAIUSDTM'
      type: 'message'
      subject: 'mark.index.price'
      data: { markPrice: 0.80694; indexPrice: 0.80695; granularity: 1000; timestamp: 1705881600000 }
    }
  | {
      topic: '/contract/instrument:BAKEUSDTM'
      type: 'message'
      subject: 'funding.rate'
      data: { granularity: 28800000; fundingRate: 0.000105; timestamp: 1705982400000 }
    }
  | {
      topic: '/contract/details:XBTUSDTM'
      type: 'message'
      subject: 'contractDetails'
      generated: true
      data: {
        symbol: 'XBTUSDTM'
        rootSymbol: 'USDT'
        type: 'FFWCSX'
        firstOpenDate: 1585555200000
        baseCurrency: 'XBT'
        quoteCurrency: 'USDT'
        settleCurrency: 'USDT'
        maxOrderQty: 1000000
        maxPrice: 1000000.0
        lotSize: 1
        tickSize: 0.1
        indexPriceTickSize: 0.01
        multiplier: 0.001
        initialMargin: 0.008
        maintainMargin: 0.004
        maxRiskLimit: 25000
        minRiskLimit: 25000
        riskStep: 12500
        makerFeeRate: 2.0e-4
        takerFeeRate: 6.0e-4
        takerFixFee: 0.0
        makerFixFee: 0.0
        isDeleverage: true
        isQuanto: true
        isInverse: false
        markMethod: 'FairPrice'
        fairMethod: 'FundingRate'
        fundingBaseSymbol: '.XBTINT8H'
        fundingQuoteSymbol: '.USDTINT8H'
        fundingRateSymbol: '.XBTUSDTMFPI8H'
        indexSymbol: '.KXBTUSDT'
        settlementSymbol: ''
        status: 'Open'
        fundingFeeRate: 3.8e-5
        predictedFundingFeeRate: 9.6e-5
        fundingRateGranularity: 28800000
        openInterest: '9295921'
        turnoverOf24h: 5.94135187191124e8
        volumeOf24h: 15131.243
        markPrice: 39995.94
        indexPrice: 39999.2
        lastTradePrice: 39996.6
        nextFundingRateTime: 10561278
        maxLeverage: 125
        sourceExchanges: ['okex', 'binance', 'kucoin', 'bybit', 'bitget', 'bitmart', 'gateio']
        premiumsSymbol1M: '.XBTUSDTMPI'
        premiumsSymbol8H: '.XBTUSDTMPI8H'
        fundingBaseSymbol1M: '.XBTINT'
        fundingQuoteSymbol1M: '.USDTINT'
        lowPrice: 38560.0
        highPrice: 40253.0
        priceChgPct: 0.0132
        priceChg: 523.4
      }
    }
