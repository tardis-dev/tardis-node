import { Exchange, Filter } from '../types.ts'
import {
  BinanceFuturesRealTimeFeed,
  BinanceJerseyRealTimeFeed,
  BinanceRealTimeFeed,
  BinanceUSRealTimeFeed,
  BinanceDeliveryRealTimeFeed
} from './binance.ts'
import { BinanceDexRealTimeFeed } from './binancedex.ts'
import { BitfinexRealTimeFeed } from './bitfinex.ts'
import { BitflyerRealTimeFeed } from './bitflyer.ts'
import { BitmexRealTimeFeed } from './bitmex.ts'
import { BitstampRealTimeFeed } from './bitstamp.ts'
import { BybitOptionsRealTimeDataFeed, BybitRealTimeDataFeed, BybitSpotRealTimeDataFeed } from './bybit.ts'
import { CoinbaseRealTimeFeed } from './coinbase.ts'
import { CryptofacilitiesRealTimeFeed } from './cryptofacilities.ts'
import { DeribitRealTimeDataFeed } from './deribit.ts'
import { FtxRealTimeFeed, FtxUSRealTimeFeed } from './ftx.ts'
import { GeminiRealTimeFeed } from './gemini.ts'
import { HitBtcRealTimeFeed } from './hitbtc.ts'
import {
  HuobiDMRealTimeFeed,
  HuobiRealTimeFeed,
  HuobiDMSwapRealTimeFeed,
  HuobiDMLinearSwapRealTimeFeed,
  HuobiDMOptionsRealTimeFeed
} from './huobi.ts'
import { KrakenRealTimeFeed } from './kraken.ts'
import { OKCoinRealTimeFeed, OkexOptionsRealTimeFeed, OkexRealTimeFeed } from './okex.ts'
import { RealTimeFeed } from './realtimefeed.ts'
import { PhemexRealTimeFeed } from './phemex.ts'
import { DeltaRealTimeFeed } from './delta.ts'
import { GateIORealTimeFeed } from './gateio.ts'
import { GateIOFuturesRealTimeFeed } from './gateiofutures.ts'
import { PoloniexRealTimeFeed } from './poloniex.ts'
import { CoinflexRealTimeFeed } from './coinflex.ts'
import { UpbitRealTimeFeed } from './upbit.ts'
import { AscendexRealTimeFeed } from './ascendex.ts'
import { DydxRealTimeFeed } from './dydx.ts'
import { SerumRealTimeFeed } from './serum.ts'
import { StarAtlasRealTimeFeed } from './staratlas.ts'
import { MangoRealTimeFeed } from './mango.ts'
import { CryptoComRealTimeFeed } from './cryptocom.ts'
import { KucoinRealTimeFeed } from './kucoin.ts'
import { BitnomialRealTimeFeed } from './bitnomial.ts'
import { WooxRealTimeFeed } from './woox.ts'
import { BlockchainComRealTimeFeed } from './blockchaincom.ts'
import { BinanceEuropeanOptionsRealTimeFeed } from './binanceeuropeanoptions.ts'
import { OkexSpreadsRealTimeFeed } from './okexspreads.ts'
import { KucoinFuturesRealTimeFeed } from './kucoinfutures.ts'
import { DydxV4RealTimeFeed } from './dydx_v4.ts'
import { BitgetFuturesRealTimeFeed, BitgetRealTimeFeed } from './bitget.ts'
import { CoinbaseInternationalRealTimeFeed } from './coinbaseinternational.ts'
import { HyperliquidRealTimeFeed } from './hyperliquid.ts'
import { LighterRealTimeFeed } from './lighter.ts'
import { BullishRealTimeFeed } from './bullish.ts'

export * from './realtimefeed.ts'

const realTimeFeedsMap: {
  [key in Exchange]?: RealTimeFeed
} = {
  bitmex: BitmexRealTimeFeed,
  binance: BinanceRealTimeFeed,
  'binance-jersey': BinanceJerseyRealTimeFeed,
  'binance-us': BinanceUSRealTimeFeed,
  'binance-dex': BinanceDexRealTimeFeed,
  'binance-futures': BinanceFuturesRealTimeFeed,
  'binance-delivery': BinanceDeliveryRealTimeFeed,
  bitfinex: BitfinexRealTimeFeed,
  'bitfinex-derivatives': BitfinexRealTimeFeed,
  bitflyer: BitflyerRealTimeFeed,
  bitstamp: BitstampRealTimeFeed,
  coinbase: CoinbaseRealTimeFeed,
  cryptofacilities: CryptofacilitiesRealTimeFeed,
  deribit: DeribitRealTimeDataFeed,
  ftx: FtxRealTimeFeed,
  'ftx-us': FtxUSRealTimeFeed,
  gemini: GeminiRealTimeFeed,
  kraken: KrakenRealTimeFeed,
  okex: OkexRealTimeFeed,
  'okex-futures': OkexRealTimeFeed,
  'okex-swap': OkexRealTimeFeed,
  'okex-options': OkexOptionsRealTimeFeed,
  'huobi-dm': HuobiDMRealTimeFeed,
  'huobi-dm-swap': HuobiDMSwapRealTimeFeed,
  'huobi-dm-linear-swap': HuobiDMLinearSwapRealTimeFeed,
  huobi: HuobiRealTimeFeed,
  bybit: BybitRealTimeDataFeed,
  okcoin: OKCoinRealTimeFeed,
  hitbtc: HitBtcRealTimeFeed,
  phemex: PhemexRealTimeFeed,
  delta: DeltaRealTimeFeed,
  'gate-io': GateIORealTimeFeed,
  'gate-io-futures': GateIOFuturesRealTimeFeed,
  poloniex: PoloniexRealTimeFeed,
  coinflex: CoinflexRealTimeFeed,
  upbit: UpbitRealTimeFeed,
  ascendex: AscendexRealTimeFeed,
  dydx: DydxRealTimeFeed,
  serum: SerumRealTimeFeed,
  'star-atlas': StarAtlasRealTimeFeed,
  'huobi-dm-options': HuobiDMOptionsRealTimeFeed,
  mango: MangoRealTimeFeed,
  'bybit-spot': BybitSpotRealTimeDataFeed,
  'bybit-options': BybitOptionsRealTimeDataFeed,
  'crypto-com': CryptoComRealTimeFeed,
  kucoin: KucoinRealTimeFeed,
  bitnomial: BitnomialRealTimeFeed,
  'woo-x': WooxRealTimeFeed,
  'blockchain-com': BlockchainComRealTimeFeed,
  'binance-european-options': BinanceEuropeanOptionsRealTimeFeed,
  'okex-spreads': OkexSpreadsRealTimeFeed,
  'kucoin-futures': KucoinFuturesRealTimeFeed,
  'dydx-v4': DydxV4RealTimeFeed,
  bitget: BitgetRealTimeFeed,
  'bitget-futures': BitgetFuturesRealTimeFeed,
  'coinbase-international': CoinbaseInternationalRealTimeFeed,
  hyperliquid: HyperliquidRealTimeFeed,
  lighter: LighterRealTimeFeed,
  bullish: BullishRealTimeFeed
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
