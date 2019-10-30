import { Exchange } from '../types'
import { BinanceFuturesRealTimeFeed, BinanceJerseyRealTimeFeed, BinanceRealTimeFeed, BinanceUSRealTimeFeed } from './binance'
import { BinanceDexRealTimeFeed } from './binancedex'
import { BitfinexRealTimeFeed } from './bitfinex'
import { BitflyerRealTimeFeed } from './bitflyer'
import { BitmexRealTimeFeed } from './bitmex'
import { BitstampRealTimeFeed } from './bitstamp'
import { CoinbaseRealTimeFeed } from './coinbase'
import { CryptofacilitiesRealTimeFeed } from './cryptofacilities'
import { DeribitRealTimeDataFeed } from './deribit'
import { FtxRealTimeFeed } from './ftx'
import { GeminiRealTimeFeed } from './gemini'
import { KrakenRealTimeFeed } from './kraken'
import { OkexRealTimeFeed } from './okex'
import { RealTimeFeed } from './realtimefeed'

export * from './realtimefeed'

const realTimeFeedsMap: {
  [key in Exchange]?: () => RealTimeFeed
} = {
  bitmex: () => new BitmexRealTimeFeed('bitmex'),
  binance: () => new BinanceRealTimeFeed('binance'),
  'binance-jersey': () => new BinanceJerseyRealTimeFeed('binance-jersey'),
  'binance-us': () => new BinanceUSRealTimeFeed('binance-us'),
  'binance-dex': () => new BinanceDexRealTimeFeed('binance-dex'),
  'binance-futures': () => new BinanceFuturesRealTimeFeed('binance-futures'),
  bitfinex: () => new BitfinexRealTimeFeed('bitfinex'),
  'bitfinex-derivatives': () => new BitfinexRealTimeFeed('bitfinex-derivatives'),
  bitflyer: () => new BitflyerRealTimeFeed('bitflyer'),
  bitstamp: () => new BitstampRealTimeFeed('bitstamp'),
  coinbase: () => new CoinbaseRealTimeFeed('coinbase'),
  cryptofacilities: () => new CryptofacilitiesRealTimeFeed('cryptofacilities'),
  deribit: () => new DeribitRealTimeDataFeed('deribit'),
  ftx: () => new FtxRealTimeFeed('ftx'),
  gemini: () => new GeminiRealTimeFeed('gemini'),
  kraken: () => new KrakenRealTimeFeed('kraken'),
  okex: () => new OkexRealTimeFeed('okex')
}

export function getRealTimeFeedFactory(exchange: Exchange): () => RealTimeFeed {
  if (realTimeFeedsMap[exchange]) {
    return realTimeFeedsMap[exchange]!
  }

  throw new Error(`not supported exchange ${exchange}`)
}

export function createRealTimeFeed(exchange: Exchange) {
  const realTimeFeedFactory = getRealTimeFeedFactory(exchange)

  return realTimeFeedFactory()
}

export function setRealTimeFeedFactory(exchange: Exchange, realTimeFeedFactory: () => RealTimeFeed) {
  realTimeFeedsMap[exchange] = realTimeFeedFactory
}
