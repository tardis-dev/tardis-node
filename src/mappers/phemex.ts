import { Mapper, PendingTickerInfoHelper } from './mapper.ts'
import { Trade, BookChange, DerivativeTicker } from '../types.ts'
import { exchangeMappers } from './registry.ts'

export const phemexMappers = exchangeMappers({
  phemex: {
    trades: () => phemexTradesMapper,
    bookChanges: () => phemexBookChangeMapper,
    derivativeTickers: () => new PhemexDerivativeTickerMapper()
  }
})

// phemex provides timestamps in nanoseconds
const fromNanoSecondsToDate = (nanos: number) => {
  const microtimestamp = Math.floor(nanos / 1000)

  const timestamp = new Date(microtimestamp / 1000)
  timestamp.μs = microtimestamp % 1000

  return timestamp
}

function getPriceScale(symbol: string) {
  if (symbol.startsWith('s')) {
    return 1e8
  }

  return 1e4
}

function getQtyScale(symbol: string) {
  if (symbol.startsWith('s')) {
    return 1e8
  }

  return 1
}

function isExcludedFromNormalizedOutput(symbol: string) {
  // Matches tardis-api metadata: Phemex spot OL/USDT uses sOLUSDT, which collides with SOLUSDT when normalized.
  return symbol === 'sOLUSDT'
}

// Uppercase normalized spot symbols can be indistinguishable from native Phemex perpetual symbols.
// Keep this list aligned with tardis-api and tardis-exporter so aliases such as SBTCUSDT can be
// converted back to sBTCUSDT without changing native perpetual symbols such as SPKUSDT.
const COINS_STARTING_WITH_S = [
  'SOLUSD',
  'SUSHIUSD',
  'SNXUSD',
  'SANDUSD',
  'SRMUSD',
  'SKLUSD',
  'SXPUSD',
  'STORJUSD',
  'SFPUSD',
  'STGUSD',
  'SLPUUSD',
  'SPELLUSD',
  'SSVUSDT',
  'SSVUSD',
  'STXUSD',
  'SUIUSD',
  'STMXUSD',
  'SEIUSD',
  'STRUSD',
  'STPTUSD',
  'SNTUSD',
  'STEEMUSD',
  'SUPERUSD',
  'SLERFUSD',
  'SAGAUSD',
  'SYNUSD',
  'SYSUSD',
  'SUNUSD',
  'SUNDOGUSD',
  'SCRUSD',
  'SANTOSUSD',
  'SAFEUSD',
  'SWELLUSD',
  'SCRTUSD',
  'SPXUSD',
  'SWARMSUSD',
  'SONICUSD',
  'SUSDT',
  'SHELLUSD',
  'SIRENUSD',
  'SERAPHUSD',
  'STOUSD',
  'SIGNUSD',
  'STICKMANUSD',
  'SYRUPUSD',
  'SXTUSD',
  'SKYAIUSD',
  'SCAUSD',
  'SAROSUSD',
  'SOONUSD',
  'SOPHUSD',
  'SKATEUSD',
  'SQDUSD',
  'SLPUSD',
  'STRAXUSD',
  'STRKUSD',
  'SOLVUSD',
  'SPKUSDT',
  'SAHARAUSDT',
  'SOLAMIUSDT',
  'SAPIENUSDT',
  'SOMIUSDT',
  'SKYUSDT',
  'STBLUSDT',
  'STABLEUSDT',
  'SENTUSDT',
  'SPORTFUNUSDT',
  'SKRUSDT',
  'SPACEUSDT',
  'SPACEXUSDT',
  'STARUSDT',
  'SOXLUSDT',
  'SPCXUSDT',
  'SAMSUNGUSDT',
  'SKHYNIXUSDT',
  'SLXUSDT',
  'SPX500USDT',
  'STXXUSDT',
  'SPYXUSDT',
  'SP500USDT',
  'SNDKUSDT',
  'SKHYUSDT',
  'SMCIUSDT',
  'SONYUSDT',
  'SQQQUSDT',
  'STRCUSDT'
]

// Phemex used the V2 `_p` channels for this short-lived, now delisted PerpetualPilot market family.
// Exact casing matters: SIRENPUSD was a pilot, while sIRENPUSD was a separate spot instrument.
const PERPETUAL_PILOT_SYMBOLS = new Set([
  'ANGLERFISHPUSD',
  'BNBCARDPUSD',
  'BNBXBTPUSD',
  'BUTTCOINPUSD',
  'CRYPTOAIPUSD',
  'CTDPUSD',
  'DOGEAIPUSD',
  'FULLSENDPUSD',
  'GHIBLIPUSD',
  'GREED3PUSD',
  'IMGPUSD',
  'MCPOSPUSD',
  'PAINPUSD',
  'PERRYPUSD',
  'SIRENPUSD',
  'TITCOINPUSD',
  'TOLYPUSD',
  'WILDNOUTPUSD'
])

function getInstrumentType(symbol: string) {
  if (/\d+$/.test(symbol)) {
    return 'future'
  }

  if (symbol.startsWith('s')) {
    return 'spot'
  }

  if (
    COINS_STARTING_WITH_S.some((coin) => (coin === 'SUSDT' ? symbol === coin : symbol.startsWith(coin))) ||
    symbol.startsWith('S') === false
  ) {
    return 'perpetual'
  }

  return 'spot'
}

function getApiSymbolId(symbolId: string) {
  // These are already exchange-native mixed-case identifiers.
  if (symbolId.startsWith('s') || symbolId.startsWith('u100') || symbolId.startsWith('c')) {
    return symbolId
  }

  // SIRENPUSD must not be mistaken for the uppercase alias of spot sIRENPUSD.
  if (PERPETUAL_PILOT_SYMBOLS.has(symbolId)) {
    return symbolId
  }

  const type = getInstrumentType(symbolId)
  if (type === 'spot' && symbolId.startsWith('S')) {
    return symbolId.charAt(0).toLowerCase() + symbolId.slice(1)
  }
  if (symbolId.startsWith('U100')) {
    return symbolId.charAt(0).toLowerCase() + symbolId.slice(1)
  }

  if (symbolId === 'CETHUSD') {
    return symbolId.charAt(0).toLowerCase() + symbolId.slice(1)
  }

  return symbolId
}

function splitSymbolsByChannelFamily(symbols: string[]) {
  const v2Symbols: string[] = []
  const legacySymbols: string[] = []

  for (const symbol of symbols) {
    const apiSymbolId = getApiSymbolId(symbol)
    const usesV2Channels =
      PERPETUAL_PILOT_SYMBOLS.has(apiSymbolId) ||
      (getInstrumentType(symbol) === 'perpetual' && (apiSymbolId.endsWith('USDT') || apiSymbolId.endsWith('USDC')))

    if (usesV2Channels) {
      v2Symbols.push(apiSymbolId)
    } else {
      legacySymbols.push(apiSymbolId)
    }
  }

  return {
    v2Symbols,
    legacySymbols
  }
}

const phemexTradesMapper: Mapper<'phemex', Trade> = {
  canHandle(message: PhemexTradeMessage) {
    return message.type === 'incremental' && ('trades' in message || 'trades_p' in message)
  },

  getFilters(symbols?: string[]) {
    if (symbols == undefined || symbols.length === 0) {
      return [
        {
          channel: 'trades'
        } as const,
        {
          channel: 'trades_p'
        } as const
      ]
    }

    const { v2Symbols, legacySymbols } = splitSymbolsByChannelFamily(symbols)

    const filters = []

    if (v2Symbols.length > 0) {
      filters.push({
        channel: 'trades_p',
        symbols: v2Symbols
      } as const)
    }
    if (legacySymbols.length > 0) {
      filters.push({
        channel: 'trades',
        symbols: legacySymbols
      } as const)
    }

    return filters
  },

  *map(message: PhemexTradeMessage, localTimestamp: Date): IterableIterator<Trade> {
    const symbol = message.symbol
    if (isExcludedFromNormalizedOutput(symbol)) {
      return
    }

    if ('trades' in message) {
      for (const [timestamp, side, priceEp, qty] of message.trades) {
        yield {
          type: 'trade',
          symbol: symbol.toUpperCase(),
          exchange: 'phemex',
          id: undefined,
          price: priceEp / getPriceScale(symbol),
          amount: qty / getQtyScale(symbol),
          side: side === 'Buy' ? 'buy' : 'sell',
          timestamp: fromNanoSecondsToDate(timestamp),
          localTimestamp: localTimestamp
        }
      }
    } else if ('trades_p' in message) {
      for (const [timestamp, side, price, qty] of message.trades_p) {
        yield {
          type: 'trade',
          symbol: symbol.toUpperCase(),
          exchange: 'phemex',
          id: undefined,
          price: Number(price),
          amount: Number(qty),
          side: side === 'Buy' ? 'buy' : 'sell',
          timestamp: fromNanoSecondsToDate(timestamp),
          localTimestamp: localTimestamp
        }
      }
    }
  }
}

const mapBookLevelForSymbol =
  (symbol: string) =>
  ([priceEp, qty]: PhemexBookLevel) => {
    return {
      price: priceEp / getPriceScale(symbol),
      amount: qty / getQtyScale(symbol)
    }
  }

function mapPerpBookLevel([price, amount]: [string, string]) {
  return {
    price: Number(price),
    amount: Number(amount)
  }
}

const phemexBookChangeMapper: Mapper<'phemex', BookChange> = {
  canHandle(message: PhemexBookMessage) {
    return 'book' in message || 'orderbook_p' in message
  },

  getFilters(symbols?: string[]) {
    if (symbols == undefined || symbols.length === 0) {
      return [
        {
          channel: 'book'
        } as const,
        {
          channel: 'orderbook_p'
        } as const
      ]
    }

    const { v2Symbols, legacySymbols } = splitSymbolsByChannelFamily(symbols)
    const filters = []

    if (v2Symbols.length > 0) {
      filters.push({
        channel: 'orderbook_p',
        symbols: v2Symbols
      } as const)
    }
    if (legacySymbols.length > 0) {
      filters.push({
        channel: 'book',
        symbols: legacySymbols
      } as const)
    }

    return filters
  },

  *map(message: PhemexBookMessage, localTimestamp: Date): IterableIterator<BookChange> {
    const symbol = message.symbol
    if (isExcludedFromNormalizedOutput(symbol)) {
      return
    }

    if ('book' in message) {
      const mapBookLevel = mapBookLevelForSymbol(symbol)
      yield {
        type: 'book_change',
        symbol: symbol.toUpperCase(),
        exchange: 'phemex',
        isSnapshot: message.type === 'snapshot',
        bids: message.book.bids.map(mapBookLevel),
        asks: message.book.asks.map(mapBookLevel),

        timestamp: fromNanoSecondsToDate(message.timestamp),
        localTimestamp
      }
    } else if ('orderbook_p' in message) {
      yield {
        type: 'book_change',
        symbol: symbol.toUpperCase(),
        exchange: 'phemex',
        isSnapshot: message.type === 'snapshot',
        bids: message.orderbook_p.bids.map(mapPerpBookLevel),
        asks: message.orderbook_p.asks.map(mapPerpBookLevel),
        timestamp: fromNanoSecondsToDate(message.timestamp),
        localTimestamp
      }
    }
  }
}

class PhemexDerivativeTickerMapper implements Mapper<'phemex', DerivativeTicker> {
  private readonly pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: PhemexTicker) {
    return 'market24h' in message || message.method === 'perp_market24h_pack_p.update'
  }

  getFilters(symbols?: string[]) {
    if (symbols == undefined || symbols.length === 0) {
      return [
        {
          channel: 'market24h'
        } as const,
        {
          channel: 'perp_market24h_pack_p'
        } as const
      ]
    }

    const { v2Symbols, legacySymbols } = splitSymbolsByChannelFamily(symbols)
    const filters = []

    if (v2Symbols.length > 0) {
      filters.push({
        channel: 'perp_market24h_pack_p',
        symbols: v2Symbols
      } as const)
    }
    if (legacySymbols.length > 0) {
      filters.push({
        channel: 'market24h',
        symbols: legacySymbols
      } as const)
    }

    return filters
  }

  *map(message: PhemexTicker, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    if ('market24h' in message) {
      const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(message.market24h.symbol, 'phemex')
      const phemexTicker = message.market24h
      pendingTickerInfo.updateFundingRate(phemexTicker.fundingRate / 100000000)
      pendingTickerInfo.updatePredictedFundingRate(phemexTicker.predFundingRate / 100000000)
      pendingTickerInfo.updateIndexPrice(phemexTicker.indexPrice / 10000)
      pendingTickerInfo.updateMarkPrice(phemexTicker.markPrice / 10000)
      pendingTickerInfo.updateOpenInterest(phemexTicker.openInterest)
      pendingTickerInfo.updateLastPrice(phemexTicker.close / 10000)
      pendingTickerInfo.updateTimestamp(fromNanoSecondsToDate(message.timestamp))

      if (pendingTickerInfo.hasChanged()) {
        yield pendingTickerInfo.getSnapshot(localTimestamp)
      }
    } else {
      for (let [
        symbol,
        _openRp,
        _highRp,
        _lowRp,
        lastRp,
        _volumeRq,
        _turnoverRv,
        openInterestRv,
        indexRp,
        markRp,
        fundingRateRr,
        predFundingRateRr
      ] of message.data) {
        const pendingTickerInfo = this.pendingTickerInfoHelper.getPendingTickerInfo(symbol, 'phemex')

        pendingTickerInfo.updateFundingRate(Number(fundingRateRr))
        pendingTickerInfo.updatePredictedFundingRate(Number(predFundingRateRr))
        pendingTickerInfo.updateIndexPrice(Number(indexRp))
        pendingTickerInfo.updateMarkPrice(Number(markRp))
        pendingTickerInfo.updateOpenInterest(Number(openInterestRv))
        pendingTickerInfo.updateLastPrice(Number(lastRp))
        pendingTickerInfo.updateTimestamp(fromNanoSecondsToDate(message.timestamp))

        if (pendingTickerInfo.hasChanged()) {
          yield pendingTickerInfo.getSnapshot(localTimestamp)
        }
      }
    }
  }
}

type PhemexTradeMessage =
  | {
      symbol: string
      trades: [[number, 'Buy' | 'Sell', number, number]]
      type: 'incremental' | 'snapshot'
    }
  | {
      sequence: 79157171
      symbol: 'BTCUSDT'
      trades_p: [[1669198793402790477, 'Buy' | 'Sell', '16545.6', '0.7']]
      type: 'snapshot' | 'incremental'
    }

type PhemexBookLevel = [number, number]

type PhemexBookMessage =
  | {
      book: {
        asks: PhemexBookLevel[]
        bids: PhemexBookLevel[]
      }

      symbol: string
      timestamp: number
      type: 'incremental' | 'snapshot'
    }
  | {
      depth: 0
      orderbook_p: {
        asks: [string, string][]
        bids: [string, string][]
      }
      sequence: 80321058
      symbol: 'BTCUSDT'
      timestamp: 1669198850490348246
      type: 'snapshot' | 'incremental'
    }

type PhemexTicker =
  | {
      market24h: {
        fundingRate: number
        indexPrice: number
        markPrice: number
        openInterest: number
        predFundingRate: number
        symbol: string
        close: number
      }

      timestamp: number
      method: undefined
    }
  | {
      data: [
        [
          'SOLUSDT',
          '11.246',
          '13.41',
          '10.91',
          '13.029',
          '10445.82',
          '127687.14224',
          '0',
          '13.03062296',
          '13.03154351',
          '0.0001',
          '0.0001'
        ],

        [
          'BTCUSDT',
          '15713.1',
          '16626',
          '15685.7',
          '16545.6',
          '1374.476',
          '22296790.4579',
          '0',
          '16553.56998432',
          '16554.73942506',
          '0.0001',
          '0.0001'
        ]
      ]
      method: 'perp_market24h_pack_p.update'
      timestamp: 1669198855202180601
      type: 'incremental'
    }
