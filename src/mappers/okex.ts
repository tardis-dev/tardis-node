import { BookChange, DerivativeTicker, Exchange, FilterForExchange, Trade } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

// https://www.okex.com/docs/en/#ws_swap-README

export class OkexTradesMapper implements Mapper<OKEX_EXCHANGES, Trade> {
  constructor(private readonly _exchange: Exchange, private readonly _market: OKEX_MARKETS) {}

  canHandle(message: OkexDataMessage) {
    return message.table === `${this._market}/trade`
  }

  getFilters(symbols?: string[]) {
    return [
      {
        channel: `${this._market}/trade`,
        symbols
      }
    ]
  }

  *map(okexTradesMessage: OKexTradesDataMessage, localTimestamp: Date): IterableIterator<Trade> {
    for (const okexTrade of okexTradesMessage.data) {
      yield {
        type: 'trade',
        symbol: okexTrade.instrument_id,
        exchange: this._exchange,
        id: okexTrade.trade_id,
        price: Number(okexTrade.price),
        amount: Number(okexTrade.qty || okexTrade.size),
        side: okexTrade.side,
        timestamp: new Date(okexTrade.timestamp),
        localTimestamp: localTimestamp
      }
    }
  }
}

const mapBookLevel = (level: OkexBookLevel) => {
  const price = Number(level[0])
  const amount = Number(level[1])

  return { price, amount }
}

export class OkexBookChangeMapper implements Mapper<OKEX_EXCHANGES, BookChange> {
  constructor(
    private readonly _exchange: Exchange,
    private readonly _market: OKEX_MARKETS,
    private readonly _canUseTickByTickChannel: boolean
  ) {}

  canHandle(message: OkexDataMessage) {
    const channelSuffix = this._canUseTickByTickChannel ? 'depth_l2_tbt' : 'depth'

    return message.table === `${this._market}/${channelSuffix}`
  }

  getFilters(symbols?: string[]) {
    if (this._canUseTickByTickChannel) {
      return [
        {
          channel: `${this._market}/depth_l2_tbt`,
          symbols
        } as const
      ]
    }

    // spot market historical data doesn't currently provide tick by tick channel
    if (this._market === 'spot') {
      return [
        {
          channel: `${this._market}/depth`,
          symbols
        } as const
      ]
    }

    // subscribe to both book channels and in canHandle decide which one to use
    // as one can subscribe to date range period that overlaps both when only depth channel has been available
    // and when both were available (both depth and depth_l2_tbt)
    return [
      {
        channel: `${this._market}/depth_l2_tbt`,
        symbols
      } as const,
      {
        channel: `${this._market}/depth`,
        symbols
      } as const
    ]
  }

  *map(okexDepthDataMessage: OkexDepthDataMessage, localTimestamp: Date): IterableIterator<BookChange> {
    for (const message of okexDepthDataMessage.data) {
      yield {
        type: 'book_change',
        symbol: message.instrument_id,
        exchange: this._exchange,
        isSnapshot: okexDepthDataMessage.action === 'partial',
        bids: message.bids.map(mapBookLevel),
        asks: message.asks.map(mapBookLevel),
        timestamp: new Date(message.timestamp),
        localTimestamp: localTimestamp
      }
    }
  }
}

export class OkexDerivativeTickerMapper implements Mapper<'okex-futures' | 'okex-swap', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()
  private _futuresChannels = ['futures/ticker', 'futures/mark_price']
  private _swapChannels = ['swap/ticker', 'swap/mark_price', 'swap/funding_rate']

  constructor(private readonly _exchange: Exchange) {}

  canHandle(message: OkexDataMessage) {
    const channels = this._exchange === 'okex-futures' ? this._futuresChannels : this._swapChannels

    return channels.includes(message.table)
  }

  getFilters(symbols?: string[]) {
    const channels = this._exchange === 'okex-futures' ? this._futuresChannels : this._swapChannels
    return channels.map(channel => {
      return {
        channel,
        symbols
      }
    })
  }

  *map(
    message: OkexTickersMessage | OkexFundingRateMessage | OkexMarkPriceMessage,
    localTimestamp: Date
  ): IterableIterator<DerivativeTicker> {
    for (const okexMessage of message.data) {
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(okexMessage.instrument_id, this._exchange)
      if ('funding_rate' in okexMessage) {
        pendingTickerInfo.updateFundingRate(Number(okexMessage.funding_rate))
        pendingTickerInfo.updatePredictedFundingRate(Number(okexMessage.estimated_rate))
        pendingTickerInfo.updateFundingTimestamp(new Date(okexMessage.funding_time))
      }

      if ('mark_price' in okexMessage) {
        pendingTickerInfo.updateMarkPrice(Number(okexMessage.mark_price))
      }
      if ('open_interest' in okexMessage) {
        pendingTickerInfo.updateOpenInterest(Number(okexMessage.open_interest))
      }
      if ('last' in okexMessage) {
        pendingTickerInfo.updateLastPrice(Number(okexMessage.last))
      }

      if (okexMessage.timestamp !== undefined) {
        pendingTickerInfo.updateTimestamp(new Date(okexMessage.timestamp))
      }

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    }
  }
}

type OkexDataMessage = {
  table: FilterForExchange['okex']['channel']
}

type OKexTradesDataMessage = {
  data: {
    side: 'buy' | 'sell'
    trade_id: string
    price: string | number
    qty?: string | number
    size?: string | number
    instrument_id: string
    timestamp: string
  }[]
}

type OkexTickersMessage = {
  data: {
    last: string | number
    best_bid: string | number
    best_ask: string | number
    open_interest: string | undefined
    instrument_id: string
    timestamp: string
  }[]
}

type OkexFundingRateMessage = {
  data: {
    funding_rate: string
    funding_time: string
    estimated_rate: string
    instrument_id: string
    timestamp: undefined
  }[]
}

type OkexMarkPriceMessage = {
  data: {
    instrument_id: string
    mark_price: string
    timestamp: string
  }[]
}

type OkexDepthDataMessage = {
  action: 'partial' | 'update'
  data: {
    instrument_id: string
    asks: OkexBookLevel[]
    bids: OkexBookLevel[]
    timestamp: string
  }[]
}

type OkexBookLevel = [number | string, number | string, number | string, number | string]

type OKEX_EXCHANGES = 'okex' | 'okcoin' | 'okex-futures' | 'okex-swap' | 'okex-options'

type OKEX_MARKETS = 'spot' | 'swap' | 'futures' | 'option'
