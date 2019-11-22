import { Exchange, Filter } from '../types'
import { BinanceFuturesRealTimeFeed, BinanceJerseyRealTimeFeed, BinanceRealTimeFeed, BinanceUSRealTimeFeed } from './binance'
import { BinanceDexRealTimeFeed } from './binancedex'
import { BitfinexRealTimeFeed } from './bitfinex'
import { BitflyerRealTimeFeed } from './bitflyer'
import { BitmexRealTimeFeed } from './bitmex'
import { BitstampRealTimeFeed } from './bitstamp'
import { BybitRealTimeDataFeed } from './bybit'
import { CoinbaseRealTimeFeed } from './coinbase'
import { CryptofacilitiesRealTimeFeed } from './cryptofacilities'
import { DeribitRealTimeDataFeed } from './deribit'
import { FtxRealTimeFeed } from './ftx'
import { GeminiRealTimeFeed } from './gemini'
import { HuobiDMRealTimeFeed, HuobiRealTimeFeed, HuobiUSRealTimeFeed } from './huobi'
import { KrakenRealTimeFeed } from './kraken'
import { OkexRealTimeFeed, OKCoinRealTimeFeed } from './okex'
import { RealTimeFeed } from './realtimefeed'
import { HitBtcRealTimeFeed } from './hitbtc'

export * from './realtimefeed'

const realTimeFeedsMap: {
  [key in Exchange]?: RealTimeFeed
} = {
  bitmex: BitmexRealTimeFeed,
  binance: BinanceRealTimeFeed,
  'binance-jersey': BinanceJerseyRealTimeFeed,
  'binance-us': BinanceUSRealTimeFeed,
  'binance-dex': BinanceDexRealTimeFeed,
  'binance-futures': BinanceFuturesRealTimeFeed,
  bitfinex: BitfinexRealTimeFeed,

  'bitfinex-derivatives': BitfinexRealTimeFeed,
  bitflyer: BitflyerRealTimeFeed,
  bitstamp: BitstampRealTimeFeed,
  coinbase: CoinbaseRealTimeFeed,
  cryptofacilities: CryptofacilitiesRealTimeFeed,
  deribit: DeribitRealTimeDataFeed,
  ftx: FtxRealTimeFeed,
  gemini: GeminiRealTimeFeed,
  kraken: KrakenRealTimeFeed,
  okex: OkexRealTimeFeed,
  'huobi-dm': HuobiDMRealTimeFeed,
  'huobi-us': HuobiUSRealTimeFeed,
  huobi: HuobiRealTimeFeed,
  bybit: BybitRealTimeDataFeed,
  okcoin: OKCoinRealTimeFeed,
  hitbtc: HitBtcRealTimeFeed
}

export function getRealTimeFeedFactory(exchange: Exchange): RealTimeFeed {
  if (realTimeFeedsMap[exchange]) {
    return realTimeFeedsMap[exchange]!
  }

  throw new Error(`not supported exchange ${exchange}`)
}

export function createRealTimeFeed(exchange: Exchange, filters: Filter<string>[], timeoutIntervalMS: number | undefined) {
  const RealTimeFeedFactory = getRealTimeFeedFactory(exchange)

  return new RealTimeFeedFactory(exchange, filters, timeoutIntervalMS)
}

export function setRealTimeFeedFactory(exchange: Exchange, realTimeFeed: RealTimeFeed) {
  realTimeFeedsMap[exchange] = realTimeFeed
}
