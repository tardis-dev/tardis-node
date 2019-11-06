import { BookChange, DerivativeTicker, Trade } from '../types'
import {
  BinanceBookChangeMapper,
  BinanceFuturesBookChangeMapper,
  BinanceFuturesDerivativeTickerMapper,
  binanceFuturesTradesMapper,
  BinanceTradesMapper
} from './binance'
import { binanceDexBookChangeMapper, binanceDexTradesMapper } from './binancedex'
import { BitfinexBookChangeMapper, BitfinexDerivativeTickerMapper, BitfinexTradesMapper } from './bitfinex'
import { bitflyerBookChangeMapper, bitflyerTradesMapper } from './bitflyer'
import { BitmexBookChangeMapper, BitmexDerivativeTickerMapper, bitmexTradesMapper } from './bitmex'
import { BitstampBookChangeMapper, bitstampTradesMapper } from './bitstamp'
import { BybitBookChangeMapper, BybitDerivativeTickerMapper, BybitTradesMapper } from './bybit'
import { coinbaseBookChangMapper, coinbaseTradesMapper } from './coinbase'
import { cryptofacilitiesBookChangeMapper, CryptofacilitiesDerivativeTickerMapper, cryptofacilitiesTradesMapper } from './cryptofacilities'
import { deribitBookChangeMapper, DeribitDerivativeTickerMapper, deribitTradesMapper } from './deribit'
import { ftxBookChangeMapper, ftxTradesMapper } from './ftx'
import { geminiBookChangeMapper, geminiTradesMapper } from './gemini'
import { HuobiBookChangeMapper, HuobiTradesMapper } from './huobi'
import { krakenBookChangeMapper, krakenTradesMapper } from './kraken'
import { Mapper } from './mapper'
import { okexBookChangeMapper, OkexDerivativeTickerMapper, okexTradesMapper } from './okex'

export * from './mapper'

const tradesMappers = {
  bitmex: () => bitmexTradesMapper,
  binance: () => new BinanceTradesMapper('binance'),
  'binance-us': () => new BinanceTradesMapper('binance-us'),
  'binance-jersey': () => new BinanceTradesMapper('binance-jersey'),
  'binance-futures': () => binanceFuturesTradesMapper,
  'binance-dex': () => binanceDexTradesMapper,
  bitfinex: () => new BitfinexTradesMapper('bitfinex'),
  'bitfinex-derivatives': () => new BitfinexTradesMapper('bitfinex-derivatives'),
  bitflyer: () => bitflyerTradesMapper,
  bitstamp: () => bitstampTradesMapper,
  coinbase: () => coinbaseTradesMapper,
  cryptofacilities: () => cryptofacilitiesTradesMapper,
  deribit: () => deribitTradesMapper,
  ftx: () => ftxTradesMapper,
  gemini: () => geminiTradesMapper,
  kraken: () => krakenTradesMapper,
  okex: () => okexTradesMapper,
  huobi: () => new HuobiTradesMapper('huobi'),
  'huobi-dm': () => new HuobiTradesMapper('huobi-dm'),
  'huobi-us': () => new HuobiTradesMapper('huobi-us'),
  bybit: () => new BybitTradesMapper('bybit')
}

const bookChangeMappers = {
  bitmex: () => new BitmexBookChangeMapper(),
  binance: () => new BinanceBookChangeMapper('binance'),
  'binance-us': () => new BinanceBookChangeMapper('binance-us'),
  'binance-jersey': () => new BinanceBookChangeMapper('binance-jersey'),
  'binance-futures': () => new BinanceFuturesBookChangeMapper(),
  'binance-dex': () => binanceDexBookChangeMapper,
  bitfinex: () => new BitfinexBookChangeMapper('bitfinex'),
  'bitfinex-derivatives': () => new BitfinexBookChangeMapper('bitfinex-derivatives'),
  bitflyer: () => bitflyerBookChangeMapper,
  bitstamp: () => new BitstampBookChangeMapper(),
  coinbase: () => coinbaseBookChangMapper,
  cryptofacilities: () => cryptofacilitiesBookChangeMapper,
  deribit: () => deribitBookChangeMapper,
  ftx: () => ftxBookChangeMapper,
  gemini: () => geminiBookChangeMapper,
  kraken: () => krakenBookChangeMapper,
  okex: () => okexBookChangeMapper,
  huobi: () => new HuobiBookChangeMapper('huobi'),
  'huobi-dm': () => new HuobiBookChangeMapper('huobi-dm'),
  'huobi-us': () => new HuobiBookChangeMapper('huobi-us'),
  bybit: () => new BybitBookChangeMapper('bybit')
}

const derivativeTickersMappers = {
  bitmex: () => new BitmexDerivativeTickerMapper(),
  'binance-futures': () => new BinanceFuturesDerivativeTickerMapper(),
  'bitfinex-derivatives': () => new BitfinexDerivativeTickerMapper(),
  cryptofacilities: () => new CryptofacilitiesDerivativeTickerMapper(),
  deribit: () => new DeribitDerivativeTickerMapper(),
  okex: () => new OkexDerivativeTickerMapper(),
  bybit: () => new BybitDerivativeTickerMapper()
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
  _localTimestamp: Date
): Mapper<T, BookChange> => {
  const createBookChangesMapper = bookChangeMappers[exchange]

  if (createBookChangesMapper === undefined) {
    throw new Error(`normalizeBookChanges: ${exchange} not supported`)
  }

  return createBookChangesMapper() as Mapper<T, BookChange>
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
