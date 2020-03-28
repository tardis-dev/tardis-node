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
import { HitBtcRealTimeFeed } from './hitbtc'
import { HuobiDMRealTimeFeed, HuobiRealTimeFeed, HuobiDMSwapRealTimeFeed } from './huobi'
import { KrakenRealTimeFeed } from './kraken'
import { OKCoinRealTimeFeed, OkexRealTimeFeed } from './okex'
import { RealTimeFeed } from './realtimefeed'

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
  'bitfinex-alts': BitfinexRealTimeFeed,
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
  'okex-futures': OkexRealTimeFeed,
  'okex-swap': OkexRealTimeFeed,
  'okex-options': OkexRealTimeFeed,
  'huobi-dm': HuobiDMRealTimeFeed,
  'huobi-dm-swap': HuobiDMSwapRealTimeFeed,
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

export function createRealTimeFeed(
  exchange: Exchange,
  filters: Filter<string>[],
  timeoutIntervalMS: number | undefined,
  onError?: (error: Error) => void
) {
  const RealTimeFeedFactory = getRealTimeFeedFactory(exchange)

  return new RealTimeFeedFactory(exchange, filters, timeoutIntervalMS, onError)
}

export function setRealTimeFeedFactory(exchange: Exchange, realTimeFeed: RealTimeFeed) {
  realTimeFeedsMap[exchange] = realTimeFeed
}
