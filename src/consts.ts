export const EXCHANGES = [
  'bitmex',
  'coinbase',
  'deribit',
  'cryptofacilities',
  'bitstamp',
  'kraken',
  'okex',
  'binance',
  'binance-jersey',
  'binance-dex',
  'bitfinex',
  'ftx'
] as const

export type Exchange = typeof EXCHANGES[number]

const BINANCE_CHANNELS = ['trade', 'ticker', 'depth', 'miniTicker', 'depthSnapshot'] as const

const BINANCE_DEX_CHANNELS = ['trades', 'marketDiff', 'kline_1m', 'ticker', 'depthSnapshot'] as const

const BITFINEX_CHANNELS = ['trades', 'book'] as const

const BITMEX_CHANNELS = [
  'trade',
  'orderBookL2',
  'liquidation',
  'connected',
  'announcement',
  'chat',
  'publicNotifications',
  'instrument',
  'settlement',
  'funding',
  'insurance',
  'orderBookL2_25',
  'quote',
  'quoteBin1m',
  'quoteBin5m',
  'quoteBin1h',
  'quoteBin1d',
  'tradeBin1m',
  'tradeBin5m',
  'tradeBin1h',
  'tradeBin1d'
] as const

const BITSTAMP_CHANNELS = ['live_trades', 'live_orders', 'diff_order_book'] as const

const COINBASE_CHANNELS = [
  'subscriptions',
  'received',
  'open',
  'done',
  'match',
  'change',
  'l2update',
  'ticker',
  'snapshot',
  'last_match',
  'full_snapshot'
] as const

const DERIBIT_CHANNELS = [
  'book',
  'deribit_price_index',
  'deribit_price_ranking',
  'estimated_expiration_price',
  'markprice.options',
  'perpetual',
  'trades',
  'ticker',
  'quote'
] as const

const KRAKEN_CHANNELS = ['ticker', 'trade', 'book', 'spread'] as const

const OKEX_CHANNELS = [
  'spot/ticker',
  'spot/trade',
  'spot/depth',
  'swap/ticker',
  'swap/trade',
  'swap/depth',
  'swap/funding_rate',
  'swap/price_range',
  'swap/mark_price',
  'futures/ticker',
  'futures/trade',
  'futures/depth',
  'futures/price_range',
  'futures/mark_price',
  'futures/estimated_price'
] as const

const CRYPTOFACILITIES_CHANNELS = ['trade', 'trade_snapshot', 'book', 'book_snapshot', 'ticker', 'heartbeat'] as const

const FTX_CHANNELS = ['orderbook', 'trades']

export const EXCHANGE_CHANNELS_INFO = {
  bitmex: BITMEX_CHANNELS,
  coinbase: COINBASE_CHANNELS,
  deribit: DERIBIT_CHANNELS,
  cryptofacilities: CRYPTOFACILITIES_CHANNELS,
  bitstamp: BITSTAMP_CHANNELS,
  kraken: KRAKEN_CHANNELS,
  okex: OKEX_CHANNELS,
  binance: BINANCE_CHANNELS,
  'binance-jersey': BINANCE_CHANNELS,
  'binance-dex': BINANCE_DEX_CHANNELS,
  bitfinex: BITFINEX_CHANNELS,
  ftx: FTX_CHANNELS
}

export type FilterForExchange = { [key in Exchange]: Filter<typeof EXCHANGE_CHANNELS_INFO[key][number]> }

export type Filter<T> = {
  channel: T
  symbols?: string[]
}
