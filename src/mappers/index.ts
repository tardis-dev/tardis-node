import { ONE_SEC_IN_MS } from '../handy'
import { BookChange, DerivativeTicker, Liquidation, OptionSummary, Trade } from '../types'
import {
  BinanceBookChangeMapper,
  BinanceFuturesBookChangeMapper,
  BinanceFuturesDerivativeTickerMapper,
  BinanceLiquidationsMapper,
  BinanceTradesMapper
} from './binance'
import { binanceDexBookChangeMapper, binanceDexTradesMapper } from './binancedex'
import { BitfinexBookChangeMapper, BitfinexDerivativeTickerMapper, BitfinexLiquidationsMapper, BitfinexTradesMapper } from './bitfinex'
import { BitflyerBookChangeMapper, bitflyerTradesMapper } from './bitflyer'
import { BitmexBookChangeMapper, BitmexDerivativeTickerMapper, bitmexLiquidationsMapper, bitmexTradesMapper } from './bitmex'
import { BitstampBookChangeMapper, bitstampTradesMapper } from './bitstamp'
import { BybitBookChangeMapper, BybitDerivativeTickerMapper, BybitTradesMapper } from './bybit'
import { CoinbaseBookChangMapper, coinbaseTradesMapper } from './coinbase'
import { coinflexBookChangeMapper, CoinflexDerivativeTickerMapper, coinflexTradesMapper } from './coinflex'
import {
  cryptofacilitiesBookChangeMapper,
  CryptofacilitiesDerivativeTickerMapper,
  cryptofacilitiesLiquidationsMapper,
  cryptofacilitiesTradesMapper
} from './cryptofacilities'
import { deltaBookChangeMapper, DeltaDerivativeTickerMapper, DeltaTradesMapper } from './delta'
import {
  deribitBookChangeMapper,
  DeribitDerivativeTickerMapper,
  deribitLiquidationsMapper,
  DeribitOptionSummaryMapper,
  deribitTradesMapper
} from './deribit'
import { FTXBookChangeMapper, FTXDerivativeTickerMapper, FTXLiquidationsMapper, FTXTradesMapper } from './ftx'
import { GateIOBookChangeMapper, GateIOTradesMapper } from './gateio'
import { GateIOFuturesBookChangeMapper, GateIOFuturesDerivativeTickerMapper, GateIOFuturesTradesMapper } from './gateiofutures'
import { geminiBookChangeMapper, geminiTradesMapper } from './gemini'
import { hitBtcBookChangeMapper, hitBtcTradesMapper } from './hitbtc'
import {
  HuobiBookChangeMapper,
  HuobiDerivativeTickerMapper,
  HuobiLiquidationsMapper,
  HuobiMBPBookChangeMapper,
  HuobiTradesMapper
} from './huobi'
import { krakenBookChangeMapper, krakenTradesMapper } from './kraken'
import { Mapper } from './mapper'
import { OkexBookChangeMapper, OkexDerivativeTickerMapper, OkexOptionSummaryMapper, OkexTradesMapper } from './okex'
import { phemexBookChangeMapper, PhemexDerivativeTickerMapper, phemexTradesMapper } from './phemex'
import { PoloniexBookChangeMapper, PoloniexTradesMapper } from './poloniex'

export * from './mapper'

const THREE_MINUTES_IN_MS = 3 * 60 * ONE_SEC_IN_MS

const isRealTime = (date: Date) => {
  if (process.env.__NO_REAL_TIME__) {
    return false
  }
  return date.valueOf() + THREE_MINUTES_IN_MS > new Date().valueOf()
}

const tradesMappers = {
  bitmex: () => bitmexTradesMapper,
  binance: () => new BinanceTradesMapper('binance'),
  'binance-us': () => new BinanceTradesMapper('binance-us'),
  'binance-jersey': () => new BinanceTradesMapper('binance-jersey'),
  'binance-futures': () => new BinanceTradesMapper('binance-futures'),
  'binance-delivery': () => new BinanceTradesMapper('binance-delivery'),
  'binance-dex': () => binanceDexTradesMapper,
  bitfinex: () => new BitfinexTradesMapper('bitfinex'),
  'bitfinex-derivatives': () => new BitfinexTradesMapper('bitfinex-derivatives'),
  bitflyer: () => bitflyerTradesMapper,
  bitstamp: () => bitstampTradesMapper,
  coinbase: () => coinbaseTradesMapper,
  cryptofacilities: () => cryptofacilitiesTradesMapper,
  deribit: () => deribitTradesMapper,
  ftx: () => new FTXTradesMapper('ftx'),
  'ftx-us': () => new FTXTradesMapper('ftx-us'),
  gemini: () => geminiTradesMapper,
  kraken: () => krakenTradesMapper,
  okex: () => new OkexTradesMapper('okex', 'spot'),
  'okex-futures': () => new OkexTradesMapper('okex-futures', 'futures'),
  'okex-swap': () => new OkexTradesMapper('okex-swap', 'swap'),
  'okex-options': () => new OkexTradesMapper('okex-options', 'option'),
  huobi: () => new HuobiTradesMapper('huobi'),
  'huobi-dm': () => new HuobiTradesMapper('huobi-dm'),
  'huobi-dm-swap': () => new HuobiTradesMapper('huobi-dm-swap'),
  bybit: () => new BybitTradesMapper('bybit'),
  okcoin: () => new OkexTradesMapper('okcoin', 'spot'),
  hitbtc: () => hitBtcTradesMapper,
  phemex: () => phemexTradesMapper,
  delta: (localTimestamp: Date) => new DeltaTradesMapper(localTimestamp.valueOf() >= new Date('2020-10-14').valueOf()),
  'gate-io': () => new GateIOTradesMapper('gate-io'),
  'gate-io-futures': () => new GateIOFuturesTradesMapper('gate-io-futures'),
  poloniex: () => new PoloniexTradesMapper(),
  coinflex: () => coinflexTradesMapper
}

const bookChangeMappers = {
  bitmex: () => new BitmexBookChangeMapper(),
  binance: (localTimestamp: Date) => new BinanceBookChangeMapper('binance', isRealTime(localTimestamp) === false),
  'binance-us': (localTimestamp: Date) => new BinanceBookChangeMapper('binance-us', isRealTime(localTimestamp) === false),
  'binance-jersey': (localTimestamp: Date) => new BinanceBookChangeMapper('binance-jersey', isRealTime(localTimestamp) === false),
  'binance-futures': (localTimestamp: Date) => new BinanceFuturesBookChangeMapper('binance-futures', isRealTime(localTimestamp) === false),
  'binance-delivery': (localTimestamp: Date) =>
    new BinanceFuturesBookChangeMapper('binance-delivery', isRealTime(localTimestamp) === false),
  'binance-dex': () => binanceDexBookChangeMapper,
  bitfinex: () => new BitfinexBookChangeMapper('bitfinex'),
  'bitfinex-derivatives': () => new BitfinexBookChangeMapper('bitfinex-derivatives'),
  bitflyer: () => new BitflyerBookChangeMapper(),
  bitstamp: () => new BitstampBookChangeMapper(),
  coinbase: () => new CoinbaseBookChangMapper(),
  cryptofacilities: () => cryptofacilitiesBookChangeMapper,
  deribit: () => deribitBookChangeMapper,
  ftx: () => new FTXBookChangeMapper('ftx'),
  'ftx-us': () => new FTXBookChangeMapper('ftx-us'),
  gemini: () => geminiBookChangeMapper,
  kraken: () => krakenBookChangeMapper,
  okex: (localTimestamp: Date) => new OkexBookChangeMapper('okex', 'spot', localTimestamp.valueOf() >= new Date('2020-04-10').valueOf()),
  'okex-futures': (localTimestamp: Date) =>
    new OkexBookChangeMapper('okex-futures', 'futures', localTimestamp.valueOf() >= new Date('2019-12-05').valueOf()),

  'okex-swap': (localTimestamp: Date) =>
    new OkexBookChangeMapper('okex-swap', 'swap', localTimestamp.valueOf() >= new Date('2020-02-08').valueOf()),
  'okex-options': (localTimestamp: Date) =>
    new OkexBookChangeMapper('okex-options', 'option', localTimestamp.valueOf() >= new Date('2020-02-08').valueOf()),
  huobi: (localTimestamp: Date) =>
    localTimestamp.valueOf() >= new Date('2020-07-03').valueOf()
      ? new HuobiMBPBookChangeMapper('huobi')
      : new HuobiBookChangeMapper('huobi'),

  'huobi-dm': () => new HuobiBookChangeMapper('huobi-dm'),
  'huobi-dm-swap': () => new HuobiBookChangeMapper('huobi-dm-swap'),
  bybit: () => new BybitBookChangeMapper('bybit', false),
  okcoin: (localTimestamp: Date) =>
    new OkexBookChangeMapper('okcoin', 'spot', localTimestamp.valueOf() >= new Date('2020-02-13').valueOf()),
  hitbtc: () => hitBtcBookChangeMapper,
  phemex: () => phemexBookChangeMapper,
  delta: () => deltaBookChangeMapper,
  'gate-io': () => new GateIOBookChangeMapper('gate-io'),
  'gate-io-futures': () => new GateIOFuturesBookChangeMapper('gate-io-futures'),
  poloniex: () => new PoloniexBookChangeMapper(),
  coinflex: () => coinflexBookChangeMapper
}

const derivativeTickersMappers = {
  bitmex: () => new BitmexDerivativeTickerMapper(),
  'binance-futures': () => new BinanceFuturesDerivativeTickerMapper('binance-futures'),
  'binance-delivery': () => new BinanceFuturesDerivativeTickerMapper('binance-delivery'),
  'bitfinex-derivatives': () => new BitfinexDerivativeTickerMapper(),
  cryptofacilities: () => new CryptofacilitiesDerivativeTickerMapper(),
  deribit: () => new DeribitDerivativeTickerMapper(),
  'okex-futures': () => new OkexDerivativeTickerMapper('okex-futures'),
  'okex-swap': () => new OkexDerivativeTickerMapper('okex-swap'),
  bybit: () => new BybitDerivativeTickerMapper(),
  phemex: () => new PhemexDerivativeTickerMapper(),
  ftx: () => new FTXDerivativeTickerMapper('ftx'),
  delta: (localTimestamp: Date) => new DeltaDerivativeTickerMapper(localTimestamp.valueOf() >= new Date('2020-10-14').valueOf()),
  'huobi-dm': () => new HuobiDerivativeTickerMapper('huobi-dm'),
  'huobi-dm-swap': () => new HuobiDerivativeTickerMapper('huobi-dm-swap'),
  'gate-io-futures': () => new GateIOFuturesDerivativeTickerMapper(),
  coinflex: () => new CoinflexDerivativeTickerMapper()
}

const optionsSummaryMappers = {
  deribit: () => new DeribitOptionSummaryMapper(),
  'okex-options': () => new OkexOptionSummaryMapper()
}

const liquidationsMappers = {
  ftx: () => new FTXLiquidationsMapper(),
  bitmex: () => bitmexLiquidationsMapper,
  deribit: () => deribitLiquidationsMapper,
  'binance-futures': () => new BinanceLiquidationsMapper('binance-futures'),
  'binance-delivery': () => new BinanceLiquidationsMapper('binance-delivery'),
  'bitfinex-derivatives': () => new BitfinexLiquidationsMapper('bitfinex-derivatives'),
  cryptofacilities: () => cryptofacilitiesLiquidationsMapper,
  'huobi-dm': () => new HuobiLiquidationsMapper('huobi-dm'),
  'huobi-dm-swap': () => new HuobiLiquidationsMapper('huobi-dm-swap')
}

export const normalizeTrades = <T extends keyof typeof tradesMappers>(exchange: T, localTimestamp: Date): Mapper<T, Trade> => {
  const createTradesMapper = tradesMappers[exchange]

  if (createTradesMapper === undefined) {
    throw new Error(`normalizeTrades: ${exchange} not supported`)
  }

  return createTradesMapper(localTimestamp) as Mapper<T, Trade>
}

export const normalizeBookChanges = <T extends keyof typeof bookChangeMappers>(
  exchange: T,
  localTimestamp: Date
): Mapper<T, BookChange> => {
  const createBookChangesMapper = bookChangeMappers[exchange]

  if (createBookChangesMapper === undefined) {
    throw new Error(`normalizeBookChanges: ${exchange} not supported`)
  }

  return createBookChangesMapper(localTimestamp) as Mapper<T, BookChange>
}

export const normalizeDerivativeTickers = <T extends keyof typeof derivativeTickersMappers>(
  exchange: T,
  localTimestamp: Date
): Mapper<T, DerivativeTicker> => {
  const createDerivativeTickerMapper = derivativeTickersMappers[exchange]

  if (createDerivativeTickerMapper === undefined) {
    throw new Error(`normalizeDerivativeTickers: ${exchange} not supported`)
  }

  return createDerivativeTickerMapper(localTimestamp) as any
}

export const normalizeOptionsSummary = <T extends keyof typeof optionsSummaryMappers>(
  exchange: T,
  _localTimestamp: Date
): Mapper<T, OptionSummary> => {
  const createOptionSummaryMapper = optionsSummaryMappers[exchange]

  if (createOptionSummaryMapper === undefined) {
    throw new Error(`normalizeOptionsSummary: ${exchange} not supported`)
  }

  return createOptionSummaryMapper() as any
}

export const normalizeLiquidations = <T extends keyof typeof liquidationsMappers>(
  exchange: T,
  _localTimestamp: Date
): Mapper<T, Liquidation> => {
  const createLiquidationsMapper = liquidationsMappers[exchange]

  if (createLiquidationsMapper === undefined) {
    throw new Error(`normalizeLiquidations: ${exchange} not supported`)
  }

  return createLiquidationsMapper() as any
}
