export const EXCHANGES = [
  'bitmex',
  'deribit',
  'binance',
  'binance-futures',
  'ftx',
  'okex',
  'okex-futures',
  'okex-swap',
  'okex-options',
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
  'bitfinex-alts',
  'binance-dex',
  'binance-jersey',
  'binance-us',
  'bybit',
  'okcoin',
  'hitbtc',
  'coinflex'
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
  'match',
  'subscriptions',
  'received',
  'open',
  'done',
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
  'quote',
  'platform_state'
] as const

const KRAKEN_CHANNELS = ['trade', 'ticker', 'book', 'spread'] as const

const OKEX_CHANNELS = ['spot/trade', 'spot/depth', 'spot/ticker'] as const

const OKCOIN_CHANNELS = ['spot/trade', 'spot/depth', 'spot/depth_l2_tbt', 'spot/ticker'] as const

const OKEX_FUTURES_CHANNELS = [
  'futures/trade',
  'futures/depth',
  'futures/depth_l2_tbt',
  'futures/ticker',
  'futures/price_range',
  'futures/mark_price',
  'futures/estimated_price',
  'index/ticker'
]

const OKEX_SWAP_CHANNELS = [
  'swap/trade',
  'swap/depth',
  'swap/depth_l2_tbt',
  'swap/ticker',
  'swap/funding_rate',
  'swap/price_range',
  'swap/mark_price',
  'index/ticker'
]

const OKEX_OPTIONS_CHANNELS = [
  'option/trade',
  'option/depth',
  'option/depth_l2_tbt',
  'option/ticker',
  'option/summary',
  'option/instruments'
]

const COINFLEX_CHANNELS = ['OrderOpened', 'OrderModified', 'OrdersMatched', 'OrderClosed', 'TickerChanged']

const CRYPTOFACILITIES_CHANNELS = ['trade', 'trade_snapshot', 'book', 'book_snapshot', 'ticker', 'heartbeat'] as const

const FTX_CHANNELS = ['orderbook', 'trades'] as const

const GEMINI_CHANNELS = ['trade', 'l2_updates', 'auction_open', 'auction_indicative', 'auction_result'] as const

const BITFLYER_CHANNELS = ['lightning_executions', 'lightning_board_snapshot', 'lightning_board', 'lightning_ticker'] as const

const BINANCE_FUTURES_CHANNELS = ['trade', 'aggTrade', 'ticker', 'depth', 'markPrice', 'depthSnapshot', 'bookTicker', 'forceOrder']

const BITFINEX_DERIV_CHANNELS = ['trades', 'book', 'status'] as const

const HUOBI_CHANNELS = ['depth', 'detail', 'trade', 'bbo'] as const

const HUOBI_DM_CHANNELS = ['depth', 'detail', 'trade'] as const

const BYBIT_CHANNELS = ['trade', 'instrument_info', 'orderBookL2_25', 'insurance', 'orderBook_200'] as const

const HITBTC_CHANNELS = ['updateTrades', 'snapshotTrades', 'snapshotOrderbook', 'updateOrderbook'] as const

export const EXCHANGE_CHANNELS_INFO = {
  bitmex: BITMEX_CHANNELS,
  coinbase: COINBASE_CHANNELS,
  deribit: DERIBIT_CHANNELS,
  cryptofacilities: CRYPTOFACILITIES_CHANNELS,
  bitstamp: BITSTAMP_CHANNELS,
  kraken: KRAKEN_CHANNELS,
  okex: OKEX_CHANNELS,
  'okex-swap': OKEX_SWAP_CHANNELS,
  'okex-futures': OKEX_FUTURES_CHANNELS,
  'okex-options': OKEX_OPTIONS_CHANNELS,
  binance: BINANCE_CHANNELS,
  'binance-jersey': BINANCE_CHANNELS,
  'binance-dex': BINANCE_DEX_CHANNELS,
  'binance-us': BINANCE_CHANNELS,
  bitfinex: BITFINEX_CHANNELS,
  'bitfinex-alts': BITFINEX_CHANNELS,
  ftx: FTX_CHANNELS,
  gemini: GEMINI_CHANNELS,
  bitflyer: BITFLYER_CHANNELS,
  'binance-futures': BINANCE_FUTURES_CHANNELS,
  'bitfinex-derivatives': BITFINEX_DERIV_CHANNELS,
  huobi: HUOBI_CHANNELS,
  'huobi-dm': HUOBI_DM_CHANNELS,
  bybit: BYBIT_CHANNELS,
  okcoin: OKCOIN_CHANNELS,
  hitbtc: HITBTC_CHANNELS,
  coinflex: COINFLEX_CHANNELS
}
