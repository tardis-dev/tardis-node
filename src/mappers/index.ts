import { bitmexTradesMapper, BitmexBookChangeMapper, BitmexDerivativeTickerMapper } from './bitmex'
import {
  BinanceTradesMapper,
  BinanceBookChangeMapper,
  binanceFuturesTradesMapper,
  BinanceFuturesBookChangeMapper,
  BinanceFuturesDerivativeTickerMapper
} from './binance'
import { binanceDexTradesMapper, binanceDexBookChangeMapper } from './binancedex'
import { BitfinexTradesMapper, BitfinexBookChangeMapper, BitfinexDerivativeTickerMapper } from './bitfinex'
import { bitflyerTradesMapper, bitflyerBookChangeMapper } from './bitflyer'
import { bitstampTradesMapper, BitstampBookChangeMapper } from './bitstamp'
import { coinbaseTradesMapper, coinbaseBookChangMapper } from './coinbase'
import { cryptofacilitiesTradesMapper, cryptofacilitiesBookChangeMapper, CryptofacilitiesDerivativeTickerMapper } from './cryptofacilities'
import { deribitTradesMapper, deribitBookChangeMapper, DeribitDerivativeTickerMapper } from './deribit'
import { ftxTradesMapper, ftxBookChangeMapper } from './ftx'
import { geminiTradesMapper, geminiBookChangeMapper } from './gemini'
import { krakenTradesMapper, krakenBookChangeMapper } from './kraken'
import { okexTradesMapper, okexBookChangeMapper, OkexDerivativeTickerMapper } from './okex'
import { Mapper } from './mapper'
import { Trade, BookChange, DerivativeTicker } from '../types'

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
  okex: () => okexTradesMapper
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
  okex: () => okexBookChangeMapper
}

const derivativeTickersMappers = {
  bitmex: () => new BitmexDerivativeTickerMapper(),
  'binance-futures': () => new BinanceFuturesDerivativeTickerMapper(),
  'bitfinex-derivatives': () => new BitfinexDerivativeTickerMapper(),
  cryptofacilities: () => new CryptofacilitiesDerivativeTickerMapper(),
  deribit: () => new DeribitDerivativeTickerMapper(),
  okex: () => new OkexDerivativeTickerMapper()
}

export const normalizeTrades = <T extends keyof typeof tradesMappers>(exchange: T): Mapper<T, Trade> => {
  const createTradesMapper = tradesMappers[exchange]

  if (createTradesMapper === undefined) {
    throw new Error(`normalizeTrades: ${exchange} not supported`)
  }

  return createTradesMapper() as Mapper<T, Trade>
}

export const normalizeBookChanges = <T extends keyof typeof bookChangeMappers>(exchange: T): Mapper<T, BookChange> => {
  const createBookChangesMapper = bookChangeMappers[exchange]

  if (createBookChangesMapper === undefined) {
    throw new Error(`normalizeBookChanges: ${exchange} not supported`)
  }

  return createBookChangesMapper() as Mapper<T, BookChange>
}

export const normalizeDerivativeTickers = <T extends keyof typeof derivativeTickersMappers>(exchange: T): Mapper<T, DerivativeTicker> => {
  const createDerivativeTickerMapper = derivativeTickersMappers[exchange]

  if (createDerivativeTickerMapper === undefined) {
    throw new Error(`normalizeDerivativeTickers: ${exchange} not supported`)
  }

  return createDerivativeTickerMapper() as any
}
