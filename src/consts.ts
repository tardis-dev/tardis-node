export const EXCHANGES = [
  'bitmex',
  'deribit',
  'binance',
  'binance-futures',
  'ftx',
  'okex',
  'huobi',
  'huobi-dm',
  'bitflyer',
  'bitstamp',
  'coinbase',
  'cryptofacilities',
  'kraken',
  'gemini',
  'bitfinex',
  'bitfinex-derivatives',
  'binance-dex',
  'binance-jersey',
  'binance-us',
  'huobi-us',
  'bybit',
  'okcoin',
  'hitbtc'
] as const

const BINANCE_CHANNELS = ['trade', 'aggTrade', 'ticker', 'depth', 'depthSnapshot', 'bookTicker'] as const

const BINANCE_DEX_CHANNELS = ['trades', 'marketDiff', 'depthSnapshot'] as const

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
  'spot/trade',
  'spot/ticker',
  'spot/depth',
  'swap/trade',
  'swap/ticker',
  'swap/depth',
  'swap/funding_rate',
  'swap/price_range',
  'swap/mark_price',
  'futures/trade',
  'futures/ticker',
  'futures/depth',
  'futures/depth_l2_tbt',
  'futures/price_range',
  'futures/mark_price',
  'futures/estimated_price',
  'index/ticker'
] as const

const CRYPTOFACILITIES_CHANNELS = ['trade', 'trade_snapshot', 'book', 'book_snapshot', 'ticker', 'heartbeat'] as const

const FTX_CHANNELS = ['orderbook', 'trades'] as const

const GEMINI_CHANNELS = ['trade', 'l2_updates', 'auction_open', 'auction_indicative', 'auction_result'] as const

const BITFLYER_CHANNELS = ['lightning_board_snapshot', 'lightning_board', 'lightning_ticker', 'lightning_executions'] as const

const BINANCE_FUTURES_CHANNELS = ['trade', 'aggTrade', 'ticker', 'depth', 'markPrice', 'depthSnapshot', 'bookTicker']

const BITFINEX_DERIV_CHANNELS = ['trades', 'book', 'status'] as const

const HUOBI_CHANNELS = ['depth', 'detail', 'trade', 'bbo'] as const

const HUOBI_US_CHANNELS = ['depth', 'detail', 'trade'] as const

const HUOBI_DM_CHANNELS = ['depth', 'detail', 'trade'] as const

const BYBIT_CHANNELS = ['trade', 'instrument_info', 'orderBookL2_25', 'insurance'] as const

const OKCOIN_CHANNELS = ['spot/trade', 'spot/depth', 'spot/ticker'] as const

const HITBTC_CHANNELS = ['snapshotTrades', 'updateTrades', 'snapshotOrderbook', 'updateOrderbook'] as const

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
  'binance-us': BINANCE_CHANNELS,
  'binance-dex': BINANCE_DEX_CHANNELS,
  bitfinex: BITFINEX_CHANNELS,
  ftx: FTX_CHANNELS,
  gemini: GEMINI_CHANNELS,
  bitflyer: BITFLYER_CHANNELS,
  'binance-futures': BINANCE_FUTURES_CHANNELS,
  'bitfinex-derivatives': BITFINEX_DERIV_CHANNELS,
  huobi: HUOBI_CHANNELS,
  'huobi-dm': HUOBI_DM_CHANNELS,
  'huobi-us': HUOBI_US_CHANNELS,
  bybit: BYBIT_CHANNELS,
  okcoin: OKCOIN_CHANNELS,
  hitbtc: HITBTC_CHANNELS
}
