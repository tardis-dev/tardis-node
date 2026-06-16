import { BookChange, BookTicker, DerivativeTicker, Exchange, Liquidation, NormalizedData, OptionSummary, Trade } from '../types.ts'
import { ascendexMappers } from './ascendex.ts'
import { binanceMappers } from './binance.ts'
import { binanceDexMappers } from './binancedex.ts'
import { binanceEuropeanOptionsMappers } from './binanceeuropeanoptions.ts'
import { bitfinexMappers } from './bitfinex.ts'
import { bitflyerMappers } from './bitflyer.ts'
import { bitgetMappers } from './bitget.ts'
import { bitmexMappers } from './bitmex.ts'
import { bitnomialMappers } from './bitnomial.ts'
import { bitstampMappers } from './bitstamp.ts'
import { blockchainComMappers } from './blockchaincom.ts'
import { bullishMappers } from './bullish.ts'
import { bybitMappers } from './bybit.ts'
import { coinbaseMappers } from './coinbase.ts'
import { coinbaseInternationalMappers } from './coinbaseinternational.ts'
import { coinflexMappers } from './coinflex.ts'
import { cryptoComMappers } from './cryptocom.ts'
import { cryptofacilitiesMappers } from './cryptofacilities.ts'
import { deltaMappers } from './delta.ts'
import { deribitMappers } from './deribit.ts'
import { dydxMappers } from './dydx.ts'
import { dydxV4Mappers } from './dydxv4.ts'
import { ftxMappers } from './ftx.ts'
import { gateIOMappers } from './gateio.ts'
import { gateIOFuturesMappers } from './gateiofutures.ts'
import { geminiMappers } from './gemini.ts'
import { hitBtcMappers } from './hitbtc.ts'
import { huobiMappers } from './huobi.ts'
import { hyperliquidMappers } from './hyperliquid.ts'
import { krakenMappers } from './kraken.ts'
import { kucoinMappers } from './kucoin.ts'
import { kucoinFuturesMappers } from './kucoinfutures.ts'
import { lighterMappers } from './lighter.ts'
import { Mapper } from './mapper.ts'
import { okexMappers } from './okex.ts'
import { phemexMappers } from './phemex.ts'
import { poloniexMappers } from './poloniex.ts'
import { polymarketMappers } from './polymarket.ts'
import { serumMappers } from './serum.ts'
import { MapperCollection, mergeExchangeMappers } from './registry.ts'
import { upbitMappers } from './upbit.ts'
import { wooxMappers } from './woox.ts'

export * from './mapper.ts'

type Normalizer<M extends MapperCollection, U extends NormalizedData> = (<T extends keyof M & Exchange>(
  exchange: T,
  localTimestamp: Date
) => Mapper<T, U>) & {
  getSwitchDates: (exchange: keyof M & Exchange) => readonly Date[]
}

const registeredMappers = mergeExchangeMappers(
  ascendexMappers,
  binanceMappers,
  binanceDexMappers,
  binanceEuropeanOptionsMappers,
  bitfinexMappers,
  bitflyerMappers,
  bitgetMappers,
  bitmexMappers,
  bitnomialMappers,
  bitstampMappers,
  blockchainComMappers,
  bullishMappers,
  bybitMappers,
  coinbaseMappers,
  coinbaseInternationalMappers,
  coinflexMappers,
  cryptoComMappers,
  cryptofacilitiesMappers,
  deltaMappers,
  deribitMappers,
  dydxMappers,
  dydxV4Mappers,
  ftxMappers,
  gateIOMappers,
  gateIOFuturesMappers,
  geminiMappers,
  hitBtcMappers,
  huobiMappers,
  hyperliquidMappers,
  krakenMappers,
  kucoinMappers,
  kucoinFuturesMappers,
  lighterMappers,
  okexMappers,
  phemexMappers,
  poloniexMappers,
  polymarketMappers,
  serumMappers,
  upbitMappers,
  wooxMappers
)

export const normalizeTrades = createNormalizer<typeof registeredMappers.trades, Trade>('normalizeTrades', registeredMappers.trades)
export const normalizeBookChanges = createNormalizer<typeof registeredMappers.bookChanges, BookChange>(
  'normalizeBookChanges',
  registeredMappers.bookChanges
)
export const normalizeDerivativeTickers = createNormalizer<typeof registeredMappers.derivativeTickers, DerivativeTicker>(
  'normalizeDerivativeTickers',
  registeredMappers.derivativeTickers
)
export const normalizeOptionsSummary = createNormalizer<typeof registeredMappers.optionsSummary, OptionSummary>(
  'normalizeOptionsSummary',
  registeredMappers.optionsSummary
)
export const normalizeLiquidations = createNormalizer<typeof registeredMappers.liquidations, Liquidation>(
  'normalizeLiquidations',
  registeredMappers.liquidations
)
export const normalizeBookTickers = createNormalizer<typeof registeredMappers.bookTickers, BookTicker>(
  'normalizeBookTickers',
  registeredMappers.bookTickers
)

function createNormalizer<M extends MapperCollection, U extends NormalizedData>(name: string, mappers: M): Normalizer<M, U> {
  const normalize = (<T extends keyof M & Exchange>(exchange: T, localTimestamp: Date) => {
    const createMapper = mappers[exchange]

    if (createMapper === undefined) {
      throw new Error(`${name}: ${exchange} not supported`)
    }

    return createMapper(localTimestamp) as Mapper<T, U>
  }) as Normalizer<M, U>

  normalize.getSwitchDates = (exchange) => getMapperSwitchDates(mappers, exchange)
  return normalize
}

function getMapperSwitchDates(mappers: MapperCollection, exchange: string) {
  return mappers[exchange]?.switchDates ?? []
}
