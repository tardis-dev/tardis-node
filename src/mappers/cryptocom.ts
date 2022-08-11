import { upperCaseSymbols } from '../handy'
import { BookChange, Exchange, BookTicker, Trade, DerivativeTicker } from '../types'
import { Mapper, PendingTickerInfoHelper } from './mapper'

export class CryptoComTradesMapper implements Mapper<'crypto-com' | 'crypto-com-derivatives', Trade> {
  constructor(private readonly _exchange: Exchange) {}
  canHandle(message: CryptoComTradeMessage) {
    return message.result !== undefined && message.result.channel === 'trade'
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    return [
      {
        channel: 'trade',
        symbols
      } as const
    ]
  }

  *map(message: CryptoComTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    message.result.data.reverse()

    for (const item of message.result.data) {
      const trade: Trade = {
        type: 'trade',
        symbol: message.result.instrument_name,
        exchange: this._exchange,
        id: item.d.toString(),
        price: Number(item.p),
        amount: Number(item.q),
        side: item.s === 'BUY' ? 'buy' : 'sell',
        timestamp: new Date(item.t),
        localTimestamp
      }

      yield trade
    }
  }
}

export class CryptoComBookChangeMapper implements Mapper<'crypto-com' | 'crypto-com-derivatives', BookChange> {
  constructor(protected readonly _exchange: Exchange) {}

  canHandle(message: CryptoComBookMessage) {
    return message.result !== undefined && message.result.channel.startsWith('book')
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

  *map(message: CryptoComBookMessage, localTimestamp: Date) {
    if (message.result.data === undefined || message.result.data[0] === undefined) {
      return
    }

    const bids = (message.result.channel === 'book' ? message.result.data[0].bids : message.result.data[0].update.bids) || []
    const asks = (message.result.channel === 'book' ? message.result.data[0].asks : message.result.data[0].update.asks) || []

    yield {
      type: 'book_change',
      symbol: message.result.instrument_name,
      exchange: this._exchange,
      isSnapshot: message.result.channel === 'book',
      bids: bids.map(this._mapBookLevel),
      asks: asks.map(this._mapBookLevel),
      timestamp: new Date(message.result.data[0].t),
      localTimestamp
    } as const
  }

  private _mapBookLevel(level: [number | string, number | string]) {
    return { price: Number(level[0]), amount: Number(level[1]) }
  }
}

export class CryptoComBookTickerMapper implements Mapper<'crypto-com' | 'crypto-com-derivatives', BookTicker> {
  constructor(protected readonly _exchange: Exchange) {}

  canHandle(message: CryptoComTickerMessage) {
    return message.result !== undefined && message.result.channel === 'ticker'
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

  *map(message: CryptoComTickerMessage, localTimestamp: Date) {
    for (const item of message.result.data) {
      const bookTicker: BookTicker = {
        type: 'book_ticker',
        symbol: message.result.instrument_name,
        exchange: this._exchange,

        askAmount: undefined,
        askPrice: item.k !== undefined && item.k !== null ? Number(item.k) : undefined,
        bidPrice: item.b !== undefined && item.b !== null ? Number(item.b) : undefined,
        bidAmount: undefined,
        timestamp: new Date(item.t),
        localTimestamp: localTimestamp
      }

      yield bookTicker
    }
  }
}

export class CryptoComDerivativeTickerMapper implements Mapper<'crypto-com-derivatives', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()
  private readonly _indexPrices = new Map<string, number>()

  constructor(protected readonly exchange: Exchange) {}

  canHandle(message: CryptoComDerivativesTickerMessage | CryptoComIndexMessage | CryptoComMarkPriceMessage | CryptoComFundingMessage) {
    if (message.result === undefined) {
      return false
    }

    return (
      message.result.channel === 'ticker' ||
      message.result.channel === 'index' ||
      message.result.channel === 'mark' ||
      message.result.channel === 'funding'
    )
  }

  getFilters(symbols?: string[]) {
    symbols = upperCaseSymbols(symbols)

    let indexes: string[] = []
    if (symbols !== undefined) {
      indexes = [...new Set(symbols.map((s) => `${s.split('-')[0]}-INDEX`))]
    }
    const filters = [
      {
        channel: 'ticker',
        symbols
      } as const,
      {
        channel: 'index',
        symbols: indexes
      } as const,
      {
        channel: 'mark',
        symbols
      } as const,
      {
        channel: 'funding',
        symbols
      } as const
    ]

    return filters
  }

  *map(
    message: CryptoComDerivativesTickerMessage | CryptoComIndexMessage | CryptoComMarkPriceMessage | CryptoComFundingMessage,
    localTimestamp: Date
  ): IterableIterator<DerivativeTicker> {
    if (message.result.channel === 'index') {
      this._indexPrices.set(message.result.instrument_name.split('-')[0], Number(message.result.data[0].v))
      return
    }

    const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.result.instrument_name, this.exchange)

    const lastIndexPrice = this._indexPrices.get(message.result.instrument_name.split('-')[0])
    if (lastIndexPrice !== undefined) {
      pendingTickerInfo.updateIndexPrice(lastIndexPrice)
    }

    if (message.result.channel === 'ticker') {
      if (message.result.data[0].a !== null && message.result.data[0].a !== undefined) {
        pendingTickerInfo.updateLastPrice(Number(message.result.data[0].a))
      }
      if (message.result.data[0].oi !== null && message.result.data[0].oi !== undefined) {
        pendingTickerInfo.updateOpenInterest(Number(message.result.data[0].oi))
      }
    }

    if (message.result.channel === 'mark') {
      if (message.result.data[0].v !== null && message.result.data[0].v !== undefined) {
        pendingTickerInfo.updateMarkPrice(Number(message.result.data[0].v))
      }
    }

    if (message.result.channel === 'funding') {
      if (message.result.data[0].v !== null && message.result.data[0].v !== undefined) {
        pendingTickerInfo.updateFundingRate(Number(message.result.data[0].v))
        const nextFundingTimestamp = new Date(message.result.data[0].t)
        nextFundingTimestamp.setUTCHours(nextFundingTimestamp.getUTCHours() + 1)
        nextFundingTimestamp.setUTCMinutes(0, 0, 0)
        pendingTickerInfo.updateFundingTimestamp(nextFundingTimestamp)
      }
    }

    pendingTickerInfo.updateTimestamp(new Date(message.result.data[0].t))

    if (pendingTickerInfo.hasChanged()) {
      yield pendingTickerInfo.getSnapshot(localTimestamp)
    }
  }
}

type CryptoComTradeMessage =
  | {
      method: 'subscribe'
      result: {
        instrument_name: 'ETH_CRO' // instrument_name
        subscription: 'trade.ETH_CRO'
        channel: 'trade'
        data: [
          {
            p: 162.12 // price
            q: 11.085 // quantity
            s: 'BUY' // side
            d: 1210447366 // trade id
            t: 1587523078844 // trade time
            dataTime: 0 // please ignore this field
          }
        ]
      }
    }
  | {
      id: -1
      code: 0
      method: 'subscribe'
      result: {
        channel: 'trade'
        subscription: 'trade.BTCUSD-PERP'
        instrument_name: 'BTCUSD-PERP'
        data: [{ d: '4611686018439397540'; t: 1653992578435; p: '31603.5'; q: '0.1000'; s: 'BUY'; i: 'BTCUSD-PERP' }]
      }
    }

type CryptoComBookMessage =
  | {
      code: 0
      method: 'subscribe'
      result: {
        instrument_name: 'ETH_CRO'
        subscription: 'book.ETH_CRO.150'
        channel: 'book'
        depth: 150
        data: [
          {
            bids: [number, number][]
            asks: [number, number][]
            t: 1659311999933
            s: 788293808
          }
        ]
      }
    }
  | {
      code: 0
      method: 'subscribe'
      result: {
        instrument_name: 'DOT_USDT'
        subscription: 'book.DOT_USDT.150'
        channel: 'book.update'
        depth: 150
        data: [
          {
            update: { bids: [number, number][]; asks: [number, number][] }
            t: 1659312000046
            s: 763793123
          }
        ]
      }
    }
  | {
      id: -1
      code: 0
      method: 'subscribe'
      result: {
        channel: 'book.update'
        subscription: 'book.BTCUSD-PERP.50'
        instrument_name: 'BTCUSD-PERP'
        depth: 50
        data: [
          {
            update: { asks: [string, string][]; bids: [string, string][] }
            t: 1653992578436
            tt: 1653992578428
            u: 72560693920
            pu: 72560688000
            cs: 380529173
          }
        ]
      }
    }

type CryptoComTickerMessage =
  | {
      code: 0
      method: 'subscribe'
      result: {
        instrument_name: 'GODS_USDT'
        subscription: 'ticker.GODS_USDT'
        channel: 'ticker'
        data: [
          {
            i: 'GODS_USDT'
            b: 0.4262
            k: 0.4272
            a: 0.4272
            t: 1659311999946
            v: 100623.01
            vv: 42986.1541
            h: 0.4624
            l: 0.4229
            c: -0.0062
            pc: -1.4302
          }
        ]
      }
    }
  | CryptoComDerivativesTickerMessage

type CryptoComDerivativesTickerMessage = {
  id: -1
  code: 0
  method: 'subscribe'
  result: {
    channel: 'ticker'
    instrument_name: 'BTCUSD-PERP'
    subscription: 'ticker.BTCUSD-PERP'
    data: [
      {
        h: '32222.5'
        l: '30240.0'
        a: '31611.0'
        c: '0.0320'
        b: '31613.0'
        k: '31613.5'
        i: 'BTCUSD-PERP'
        v: '13206.4884'
        vv: '433945264.39'
        oi: '318.5162'
        t: 1653992543383
      }
    ]
  }
}

type CryptoComIndexMessage = {
  id: -1
  method: 'subscribe'
  code: 0
  result: {
    instrument_name: 'BTCUSD-INDEX'
    subscription: 'index.BTCUSD-INDEX'
    channel: 'index'
    data: [{ v: '31601.35'; t: 1653992545000 }]
  }
}

type CryptoComMarkPriceMessage = {
  id: 1
  method: 'subscribe'
  code: 0
  result: {
    instrument_name: 'BTCUSD-PERP'
    subscription: 'mark.BTCUSD-PERP'
    channel: 'mark'
    data: [{ v: '31606.3'; t: 1653992543000 }]
  }
}

type CryptoComFundingMessage = {
  id: -1
  method: 'subscribe'
  code: 0
  result: {
    instrument_name: 'BTCUSD-PERP'
    subscription: 'funding.BTCUSD-PERP'
    channel: 'funding'
    data: [{ v: '0.00000700'; t: 1653992579000 }]
  }
}
