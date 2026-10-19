import { asNonZeroNumberOrUndefined, asNumberOrUndefined, fromMicroSecondsToDate, upperCaseSymbols } from '../handy.ts'
import type { BookChange, BookTicker, DerivativeTicker, OptionSummary, Trade } from '../types.ts'
import { type Mapper, PendingTickerInfoHelper } from './mapper.ts'
import { exchangeMappers } from './registry.ts'

export const deltaIndiaMappers = exchangeMappers({
  'delta-india': {
    trades: () => new DeltaIndiaTradesMapper(),
    bookChanges: () => new DeltaIndiaBookChangeMapper(),
    bookTickers: () => new DeltaIndiaBookTickerMapper(),
    derivativeTickers: () => new DeltaIndiaDerivativeTickerMapper(),
    optionsSummary: () => new DeltaIndiaOptionSummaryMapper()
  }
})

class DeltaIndiaTradesMapper implements Mapper<'delta-india', Trade> {
  canHandle(message: DeltaIndiaTrade) {
    return message.type === 'trades'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'trades', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: DeltaIndiaTrade, localTimestamp: Date): IterableIterator<Trade> {
    yield {
      type: 'trade',
      exchange: 'delta-india',
      symbol: message.sy,
      id: undefined,
      price: Number(message.p),
      amount: Number(message.s),
      side: message.r === 't' ? 'buy' : 'sell',
      timestamp: fromMicroSecondsToDate(message.t),
      localTimestamp
    }
  }
}

class DeltaIndiaBookChangeMapper implements Mapper<'delta-india', BookChange> {
  private readonly initialized = new Set<string>()

  canHandle(message: DeltaIndiaDepth | DeltaIndiaDepthError) {
    return message.type === 'ob_updates' && (message.action === 'snapshot' || message.action === 'update' || message.action === 'error')
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'ob_updates', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: DeltaIndiaDepth | DeltaIndiaDepthError, localTimestamp: Date): IterableIterator<BookChange> {
    if (message.action === 'error') {
      this.initialized.delete(message.symbol)
      return
    }

    if (message.action === 'snapshot') {
      this.initialized.add(message.sy)
    }

    if (!this.initialized.has(message.sy)) {
      return
    }

    yield {
      type: 'book_change',
      exchange: 'delta-india',
      symbol: message.sy,
      isSnapshot: message.action === 'snapshot',
      bids: message.b.map(this.mapLevel),
      asks: message.a.map(this.mapLevel),
      timestamp: fromMicroSecondsToDate(message.ts),
      localTimestamp
    }
  }

  private mapLevel([price, amount]: DeltaIndiaBookLevel) {
    return { price: Number(price), amount: Number(amount) }
  }
}

class DeltaIndiaBookTickerMapper implements Mapper<'delta-india', BookTicker> {
  canHandle(message: DeltaIndiaBBO) {
    return message.type === 'ob_l1'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'ob_l1', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: DeltaIndiaBBO, localTimestamp: Date): IterableIterator<BookTicker> {
    yield {
      type: 'book_ticker',
      exchange: 'delta-india',
      symbol: message.sy,
      askPrice: asNonZeroNumberOrUndefined(message.ap),
      askAmount: asNonZeroNumberOrUndefined(message.as),
      bidPrice: asNonZeroNumberOrUndefined(message.bp),
      bidAmount: asNonZeroNumberOrUndefined(message.bs),
      timestamp: fromMicroSecondsToDate(message.lts),
      localTimestamp
    }
  }
}

class DeltaIndiaDerivativeTickerMapper implements Mapper<'delta-india', DerivativeTicker> {
  private readonly pending = new PendingTickerInfoHelper()

  canHandle(message: DeltaIndiaTicker | DeltaIndiaPrice | DeltaIndiaFunding) {
    return message.type === 'ticker' || message.type === 'mark_price' || message.type === 'funding_rate'
  }

  getFilters(symbols?: string[]) {
    const uppercaseSymbols = upperCaseSymbols(symbols)
    const markPriceSymbols = uppercaseSymbols?.filter(isDerivative).map((symbol) => `MARK:${symbol}`)
    const perpetualSymbols = uppercaseSymbols?.filter((symbol) => !symbol.includes('-') && !symbol.includes('_'))
    return [
      { channel: 'ticker', symbols: uppercaseSymbols } as const,
      ...(markPriceSymbols?.length === 0 ? [] : [{ channel: 'mark_price', symbols: markPriceSymbols } as const]),
      ...(perpetualSymbols?.length === 0 ? [] : [{ channel: 'funding_rate', symbols: perpetualSymbols } as const])
    ]
  }

  *map(message: DeltaIndiaTicker | DeltaIndiaPrice | DeltaIndiaFunding, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const timestamp = fromMicroSecondsToDate(message.ts)

    if (message.type === 'mark_price' || message.type === 'funding_rate') {
      const symbol = message.sy.replace(/^MARK:/, '')
      if (!isDerivative(symbol)) {
        return
      }

      const pending = this.pending.getPendingTickerInfo(symbol, 'delta-india')
      if (message.type === 'mark_price') {
        pending.updateMarkPrice(asNumberOrUndefined(message.p))
      } else {
        // Delta publishes funding rates in percentage points; normalized rates are fractions.
        pending.updateFundingRate(Number(message.fr) / 100)
        pending.updateFundingTimestamp(fromMicroSecondsToDate(message.nfr))
      }
      pending.updateTimestamp(timestamp)

      if (pending.hasChanged()) {
        yield pending.getSnapshot(localTimestamp)
      }
      return
    }

    for (const ticker of message.d) {
      if (!isDerivative(ticker.s)) {
        continue
      }

      const pending = this.pending.getPendingTickerInfo(ticker.s, 'delta-india')
      pending.updateLastPrice(asNumberOrUndefined(ticker.ohlc[3]))
      pending.updateOpenInterest(asNumberOrUndefined(ticker.oi[0]))
      pending.updateMarkPrice(asNumberOrUndefined(ticker.m))
      pending.updateIndexPrice(asNumberOrUndefined(message.sp))
      pending.updateTimestamp(timestamp)

      if (pending.hasChanged()) {
        yield pending.getSnapshot(localTimestamp)
      }
    }
  }
}

class DeltaIndiaOptionSummaryMapper implements Mapper<'delta-india', OptionSummary> {
  canHandle(message: DeltaIndiaTicker) {
    return message.type === 'ticker'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'ticker', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: DeltaIndiaTicker, localTimestamp: Date): IterableIterator<OptionSummary> {
    for (const ticker of message.d) {
      if (!isOption(ticker.s)) {
        continue
      }
      const [side, asset, strike, expiry] = ticker.s.split('-')

      yield {
        type: 'option_summary',
        exchange: 'delta-india',
        symbol: ticker.s,
        optionType: side === 'C' ? 'call' : 'put',
        strikePrice: Number(strike),
        expirationDate: this.getExpirationDate(expiry),
        bestAskPrice: asNonZeroNumberOrUndefined(ticker.q[0]),
        bestAskAmount: asNonZeroNumberOrUndefined(ticker.q[1]),
        bestBidPrice: asNonZeroNumberOrUndefined(ticker.q[2]),
        bestBidAmount: asNonZeroNumberOrUndefined(ticker.q[3]),
        bestAskIV: this.mapIV(ticker.qiv[0]),
        bestBidIV: this.mapIV(ticker.qiv[1]),
        markIV: this.mapIV(ticker.qiv[2]),
        lastPrice: asNumberOrUndefined(ticker.ohlc[3]),
        openInterest: asNumberOrUndefined(ticker.oi[0]),
        markPrice: asNumberOrUndefined(ticker.m),
        delta: asNumberOrUndefined(ticker.g[0]),
        gamma: asNumberOrUndefined(ticker.g[1]),
        rho: asNumberOrUndefined(ticker.g[2]),
        theta: asNumberOrUndefined(ticker.g[3]),
        vega: asNumberOrUndefined(ticker.g[4]),
        underlyingPrice: asNumberOrUndefined(message.sp),
        underlyingIndex: asset === 'BTC' ? '.DEXBTUSD' : `.DE${asset}USD`,
        timestamp: fromMicroSecondsToDate(message.ts),
        localTimestamp
      }
    }
  }

  private getExpirationDate(expiry: string) {
    const day = Number(expiry.slice(0, 2))
    const month = Number(expiry.slice(2, 4))
    const year = 2000 + Number(expiry.slice(4))
    // India options expire at 17:30 IST (12:00 UTC), encoded as DDMMYY in the native symbol.
    return new Date(Date.UTC(year, month - 1, day, 12))
  }

  private mapIV(value: string | null) {
    const iv = asNumberOrUndefined(value)
    return iv !== undefined && iv >= 0 ? iv : undefined
  }
}

function isDerivative(symbol: string) {
  return !isOption(symbol) && !symbol.endsWith('_INR')
}
function isOption(symbol: string) {
  return symbol.startsWith('C-') || symbol.startsWith('P-')
}

type DeltaIndiaChannel =
  | 'trades'
  | 'ob_updates'
  | 'ob_l1'
  | 'ticker'
  | 'mark_price'
  | 'funding_rate'
  | 'spot_price'
  | 'spot_30mtwap_price'
  | 'product_updates'
  | 'system_status'

type DeltaIndiaMessage<Channel extends DeltaIndiaChannel> = {
  type: Channel
  sy: string
  ts: number
}

type DeltaIndiaTrade = DeltaIndiaMessage<'trades'> & {
  p: string
  s: number
  r: 't' | 'm'
  t: number
}

type DeltaIndiaDepth = DeltaIndiaMessage<'ob_updates'> & {
  action: 'snapshot' | 'update'
  a: DeltaIndiaBookLevel[]
  b: DeltaIndiaBookLevel[]
  seq: number
  cs: number
}
type DeltaIndiaBookLevel = [price: string, size: string]

type DeltaIndiaBBO = DeltaIndiaMessage<'ob_l1'> & {
  ap: string | null
  as: string | null
  bp: string | null
  bs: string | null
  lts: number
}

type DeltaIndiaPrice = DeltaIndiaMessage<'mark_price'> & {
  p: string
}

type DeltaIndiaFunding = DeltaIndiaMessage<'funding_rate'> & {
  fr: number
  fi: number
  nfr: number
}

type DeltaIndiaTicker = DeltaIndiaMessage<'ticker'> & {
  sp: string | null
  d: DeltaIndiaTickerContract[]
}

type DeltaIndiaTickerContract = {
  i: number
  s: string
  m: string | null
  m24hc: string
  ohlc: [open: number | null, high: number | null, low: number | null, close: number | null]
  oi: [contracts: string | null, change: string | null]
  pb: [lower: string | null, upper: string | null]
  q: [askPrice: string | null, askSize: string | null, bidPrice: string | null, bidSize: string | null, impactMidPrice: string | null]
  qiv: [ask: string | null, bid: string | null, mark: string | null]
  g: [delta: string | null, gamma: string | null, rho: string | null, theta: string | null, vega: string | null]
  to: [turnover: number | null, turnoverUSD: number | null]
}

// Depth errors use `symbol` rather than `sy` and do not include a timestamp.
type DeltaIndiaDepthError = {
  type: 'ob_updates'
  action: 'error'
  symbol: string
  msg: string
}
