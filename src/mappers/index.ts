import { ONE_SEC_IN_MS } from '../handy'
import { BookChange, DerivativeTicker, Trade, OptionSummary } from '../types'
import {
  BinanceBookChangeMapper,
  BinanceFuturesBookChangeMapper,
  BinanceFuturesDerivativeTickerMapper,
  BinanceTradesMapper
} from './binance'
import { binanceDexBookChangeMapper, binanceDexTradesMapper } from './binancedex'
import { BitfinexBookChangeMapper, BitfinexDerivativeTickerMapper, BitfinexTradesMapper } from './bitfinex'
import { BitflyerBookChangeMapper, bitflyerTradesMapper } from './bitflyer'
import { BitmexBookChangeMapper, BitmexDerivativeTickerMapper, bitmexTradesMapper } from './bitmex'
import { BitstampBookChangeMapper, bitstampTradesMapper } from './bitstamp'
import { BybitBookChangeMapper, BybitDerivativeTickerMapper, BybitTradesMapper } from './bybit'
import { CoinbaseBookChangMapper, coinbaseTradesMapper } from './coinbase'
import { cryptofacilitiesBookChangeMapper, CryptofacilitiesDerivativeTickerMapper, cryptofacilitiesTradesMapper } from './cryptofacilities'
import { deribitBookChangeMapper, DeribitDerivativeTickerMapper, deribitTradesMapper, DeribitOptionSummaryMapper } from './deribit'
import { ftxBookChangeMapper, ftxTradesMapper, FTXDerivativeTickerMapper } from './ftx'
import { geminiBookChangeMapper, geminiTradesMapper } from './gemini'
import { hitBtcBookChangeMapper, hitBtcTradesMapper } from './hitbtc'
import { HuobiBookChangeMapper, HuobiTradesMapper } from './huobi'
import { krakenBookChangeMapper, krakenTradesMapper } from './kraken'
import { Mapper } from './mapper'
import { OkexBookChangeMapper, OkexDerivativeTickerMapper, OkexTradesMapper, OkexOptionSummaryMapper } from './okex'
import { phemexTradesMapper, phemexBookChangeMapper, PhemexDerivativeTickerMapper } from './phemex'

export * from './mapper'

const THREE_MINUTES_IN_MS = 3 * 60 * ONE_SEC_IN_MS

const isRealTime = (date: Date) => {
  return date.valueOf() + THREE_MINUTES_IN_MS > new Date().valueOf()
}

const tradesMappers = {
  bitmex: () => bitmexTradesMapper,
  binance: () => new BinanceTradesMapper('binance'),
  'binance-us': () => new BinanceTradesMapper('binance-us'),
  'binance-jersey': () => new BinanceTradesMapper('binance-jersey'),
  'binance-futures': () => new BinanceTradesMapper('binance-futures'),
  'binance-dex': () => binanceDexTradesMapper,
  bitfinex: () => new BitfinexTradesMapper('bitfinex'),
  'bitfinex-derivatives': () => new BitfinexTradesMapper('bitfinex-derivatives'),
  'bitfinex-alts': () => new BitfinexTradesMapper('bitfinex-alts'),
  bitflyer: () => bitflyerTradesMapper,
  bitstamp: () => bitstampTradesMapper,
  coinbase: () => coinbaseTradesMapper,
  cryptofacilities: () => cryptofacilitiesTradesMapper,
  deribit: () => deribitTradesMapper,
  ftx: () => ftxTradesMapper,
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
  phemex: () => phemexTradesMapper
}

const bookChangeMappers = {
  bitmex: () => new BitmexBookChangeMapper(),
  binance: (localTimestamp: Date) => new BinanceBookChangeMapper('binance', isRealTime(localTimestamp) === false),
  'binance-us': (localTimestamp: Date) => new BinanceBookChangeMapper('binance-us', isRealTime(localTimestamp) === false),
  'binance-jersey': (localTimestamp: Date) => new BinanceBookChangeMapper('binance-jersey', isRealTime(localTimestamp) === false),
  'binance-futures': (localTimestamp: Date) => new BinanceFuturesBookChangeMapper(isRealTime(localTimestamp) === false),
  'binance-dex': () => binanceDexBookChangeMapper,
  bitfinex: () => new BitfinexBookChangeMapper('bitfinex'),
  'bitfinex-derivatives': () => new BitfinexBookChangeMapper('bitfinex-derivatives'),
  'bitfinex-alts': () => new BitfinexBookChangeMapper('bitfinex-alts'),
  bitflyer: () => new BitflyerBookChangeMapper(),
  bitstamp: () => new BitstampBookChangeMapper(),
  coinbase: () => new CoinbaseBookChangMapper(),
  cryptofacilities: () => cryptofacilitiesBookChangeMapper,
  deribit: () => deribitBookChangeMapper,
  ftx: () => ftxBookChangeMapper,
  gemini: () => geminiBookChangeMapper,
  kraken: () => krakenBookChangeMapper,
  okex: (localTimestamp: Date) => new OkexBookChangeMapper('okex', 'spot', localTimestamp.valueOf() >= new Date('2020-04-10').valueOf()),
  'okex-futures': (localTimestamp: Date) =>
    new OkexBookChangeMapper('okex-futures', 'futures', localTimestamp.valueOf() >= new Date('2019-12-05').valueOf()),

  'okex-swap': (localTimestamp: Date) =>
    new OkexBookChangeMapper('okex-swap', 'swap', localTimestamp.valueOf() >= new Date('2020-02-08').valueOf()),
  'okex-options': (localTimestamp: Date) =>
    new OkexBookChangeMapper('okex-options', 'option', localTimestamp.valueOf() >= new Date('2020-02-08').valueOf()),
  huobi: () => new HuobiBookChangeMapper('huobi'),
  'huobi-dm': () => new HuobiBookChangeMapper('huobi-dm'),
  'huobi-dm-swap': () => new HuobiBookChangeMapper('huobi-dm-swap'),
  bybit: () => new BybitBookChangeMapper('bybit', false),
  okcoin: (localTimestamp: Date) =>
    new OkexBookChangeMapper('okcoin', 'spot', localTimestamp.valueOf() >= new Date('2020-02-13').valueOf()),
  hitbtc: () => hitBtcBookChangeMapper,
  phemex: () => phemexBookChangeMapper
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
  ftx: () => new FTXDerivativeTickerMapper()
}

const optionsSummaryMappers = {
  deribit: () => new DeribitOptionSummaryMapper(),
  'okex-options': () => new OkexOptionSummaryMapper()
}

export const normalizeTrades = <T extends keyof typeof tradesMappers>(exchange: T, _localTimestamp: Date): Mapper<T, Trade> => {
  const createTradesMapper = tradesMappers[exchange]

  if (createTradesMapper === undefined) {
    throw new Error(`normalizeTrades: ${exchange} not supported`)
  }

  return createTradesMapper() as Mapper<T, Trade>
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
  _localTimestamp: Date
): Mapper<T, DerivativeTicker> => {
  const createDerivativeTickerMapper = derivativeTickersMappers[exchange]

  if (createDerivativeTickerMapper === undefined) {
    throw new Error(`normalizeDerivativeTickers: ${exchange} not supported`)
  }

  return createDerivativeTickerMapper() as any
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
