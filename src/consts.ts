export const EXCHANGES = [
  'bitmex',
  'deribit',
  'binance-futures',
  'binance-delivery',
  'binance-options',
  'binance-european-options',
  'binance',
  'ftx',
  'okex-futures',
  'okex-options',
  'okex-swap',
  'okex',
  'okex-spreads',
  'huobi-dm',
  'huobi-dm-swap',
  'huobi-dm-linear-swap',
  'huobi',
  'bitfinex-derivatives',
  'bitfinex',
  'coinbase',
  'coinbase-international',
  'cryptofacilities',
  'kraken',
  'bitstamp',
  'gemini',
  'poloniex',
  'bybit',
  'bybit-spot',
  'bybit-options',
  'phemex',
  'delta',
  'ftx-us',
  'binance-us',
  'gate-io-futures',
  'gate-io',
  'okcoin',
  'bitflyer',
  'hitbtc',
  'coinflex',
  'binance-jersey',
  'binance-dex',
  'upbit',
  'ascendex',
  'dydx',
  'dydx-v4',
  'serum',
  'mango',
  'huobi-dm-options',
  'star-atlas',
  'crypto-com',
  'crypto-com-derivatives',
  'kucoin',
  'kucoin-futures',
  'bitnomial',
  'woo-x',
  'blockchain-com',
  'bitget',
  'bitget-futures',
  'hyperliquid'
] as const

const BINANCE_CHANNELS = ['trade', 'aggTrade', 'ticker', 'depth', 'depthSnapshot', 'bookTicker', 'recentTrades', 'borrowInterest'] as const
const BINANCE_DEX_CHANNELS = ['trades', 'marketDiff', 'depthSnapshot', 'ticker'] as const
const BITFINEX_CHANNELS = ['trades', 'book', 'raw_book', 'ticker'] as const

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
  'orderBook10',
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
  'deribit_volatility_index',
  'estimated_expiration_price',
  'markprice.options',
  'perpetual',
  'trades',
  'ticker',
  'quote',
  'platform_state',
  'instrument.state.any'
] as const

const KRAKEN_CHANNELS = ['trade', 'ticker', 'book', 'spread'] as const

const OKEX_CHANNELS = [
  'spot/trade',
  'spot/depth',
  'spot/depth_l2_tbt',
  'spot/ticker',
  'system/status',
  'margin/interest_rate',

  // v5
  'trades',
  'trades-all',
  'books-l2-tbt',
  'bbo-tbt',
  'books',
  'tickers',
  'interest-rate-loan-quota',
  'vip-interest-rate-loan-quota',
  'status',
  'instruments',
  'taker-volume',
  'public-struc-block-trades'
] as const

const OKCOIN_CHANNELS = [
  'spot/trade',
  'spot/depth',
  'spot/depth_l2_tbt',
  'spot/ticker',
  'system/status',
  'trades',
  'books',
  'bbo-tbt',
  'tickers'
] as const

const OKEX_FUTURES_CHANNELS = [
  'futures/trade',
  'futures/depth',
  'futures/depth_l2_tbt',
  'futures/ticker',
  'futures/mark_price',
  'futures/liquidation',
  'index/ticker',
  'system/status',
  'information/sentiment',
  'information/long_short_ratio',
  'information/margin',

  // v5
  'trades',
  'trades-all',
  'books-l2-tbt',
  'bbo-tbt',
  'books',
  'tickers',
  'open-interest',
  'mark-price',
  'price-limit',
  'status',
  'instruments',
  'index-tickers',
  'long-short-account-ratio',
  'taker-volume',
  'liquidations',
  'public-struc-block-trades',
  'liquidation-orders'
] as const

const OKEX_SWAP_CHANNELS = [
  'swap/trade',
  'swap/depth',
  'swap/depth_l2_tbt',
  'swap/ticker',
  'swap/funding_rate',
  'swap/mark_price',
  'swap/liquidation',
  'index/ticker',
  'system/status',
  'information/sentiment',
  'information/long_short_ratio',
  'information/margin',

  //v5
  'trades',
  'trades-all',
  'books-l2-tbt',
  'bbo-tbt',
  'books',
  'tickers',
  'open-interest',
  'mark-price',
  'price-limit',
  'funding-rate',
  'status',
  'instruments',
  'index-tickers',
  'long-short-account-ratio',
  'taker-volume',
  'liquidations',
  'public-struc-block-trades',
  'liquidation-orders'
] as const

const OKEX_OPTIONS_CHANNELS = [
  'option/trade',
  'option/depth',
  'option/depth_l2_tbt',
  'option/ticker',
  'option/summary',
  'option/instruments',
  'index/ticker',
  'system/status',
  'option/trades',

  //v5
  'trades',
  'trades-all',
  'books-l2-tbt',
  'bbo-tbt',
  'books',
  'tickers',
  'opt-summary',
  'status',
  'instruments',
  'index-tickers',
  'open-interest',
  'mark-price',
  'price-limit',
  'public-struc-block-trades',
  'option-trades'
] as const

const COINFLEX_CHANNELS = ['futures/depth', 'trade', 'ticker'] as const

const CRYPTOFACILITIES_CHANNELS = ['trade', 'trade_snapshot', 'book', 'book_snapshot', 'ticker', 'heartbeat'] as const

const FTX_CHANNELS = [
  'orderbook',
  'trades',
  'instrument',
  'markets',
  'orderbookGrouped',
  'lendingRate',
  'borrowRate',
  'borrowSummary',
  'ticker',
  'leveragedTokenInfo'
] as const

const GEMINI_CHANNELS = ['trade', 'l2_updates', 'auction_open', 'auction_indicative', 'auction_result'] as const

const BITFLYER_CHANNELS = ['lightning_executions', 'lightning_board_snapshot', 'lightning_board', 'lightning_ticker'] as const

const BINANCE_FUTURES_CHANNELS = [
  'trade',
  'aggTrade',
  'ticker',
  'depth',
  'markPrice',
  'depthSnapshot',
  'bookTicker',
  'forceOrder',
  'openInterest',
  'recentTrades',
  'compositeIndex',
  'topLongShortAccountRatio',
  'topLongShortPositionRatio',
  'globalLongShortAccountRatio',
  'takerlongshortRatio'
] as const

const BINANCE_DELIVERY_CHANNELS = [
  'trade',
  'aggTrade',
  'ticker',
  'depth',
  'markPrice',
  'indexPrice',
  'depthSnapshot',
  'bookTicker',
  'forceOrder',
  'openInterest',
  'recentTrades',
  'topLongShortAccountRatio',
  'topLongShortPositionRatio',
  'globalLongShortAccountRatio',
  'takerBuySellVol'
] as const

const BITFINEX_DERIV_CHANNELS = ['trades', 'book', 'raw_book', 'status', 'liquidations', 'ticker'] as const

const HUOBI_CHANNELS = ['depth', 'detail', 'trade', 'bbo', 'mbp', 'etp'] as const

const HUOBI_DM_CHANNELS = [
  'depth',
  'detail',
  'trade',
  'bbo',
  'basis',
  'liquidation_orders',
  'contract_info',
  'open_interest',
  'elite_account_ratio',
  'elite_position_ratio'
] as const

const HUOBI_DM_SWAP_CHANNELS = [
  'depth',
  'detail',
  'trade',
  'bbo',
  'basis',
  'funding_rate',
  'liquidation_orders',
  'contract_info',
  'open_interest',
  'elite_account_ratio',
  'elite_position_ratio'
] as const

const HUOBI_DM_LINEAR_SWAP_CHANNELS = [
  'depth',
  'detail',
  'trade',
  'bbo',
  'basis',
  'funding_rate',
  'liquidation_orders',
  'contract_info',
  'open_interest',
  'elite_account_ratio',
  'elite_position_ratio'
] as const

const BINANCE_OPTIONS_CHANNELS = ['TRADE', 'TICKER', 'DEPTH100', 'INDEX'] as const

const PHEMEX_CHANNELS = ['book', 'orderbook_p', 'trades', 'trades_p', 'market24h', 'spot_market24h', 'perp_market24h_pack_p'] as const

const BYBIT_CHANNELS = [
  'trade',
  'instrument_info',
  'orderBookL2_25',
  'insurance',
  'orderBook_200',
  'liquidation',
  'trade',
  'instrument_info',
  'orderBookL2_25',
  'insurance',
  'orderBook_200',
  'liquidation',
  'long_short_ratio',
  'orderbook.1',
  'orderbook.50',
  'orderbook.500',
  'publicTrade',
  'tickers',
  'liquidation',
  'allLiquidation'
] as const

const BYBIT_OPTIONS_CHANNELS = ['orderbook.25', 'orderbook.100', 'publicTrade', 'tickers']

const HITBTC_CHANNELS = ['updateTrades', 'snapshotTrades', 'snapshotOrderbook', 'updateOrderbook'] as const

const FTX_US_CHANNELS = ['orderbook', 'trades', 'markets', 'orderbookGrouped', 'ticker'] as const

const DELTA_CHANNELS = [
  'l2_orderbook',
  'recent_trade',
  'recent_trade_snapshot',
  'mark_price',
  'spot_price',
  'funding_rate',
  'product_updates',
  'announcements',
  'all_trades',
  'v2/ticker',
  'l1_orderbook',
  'l2_updates',
  'spot_30mtwap_price'
] as const

const GATE_IO_CHANNELS = ['trades', 'depth', 'ticker', 'book_ticker', 'order_book_update'] as const
const GATE_IO_FUTURES_CHANNELS = ['trades', 'order_book', 'tickers', 'book_ticker'] as const
const POLONIEX_CHANNELS = ['price_aggregated_book', 'trades', 'ticker', 'book_lv2'] as const
const UPBIT_CHANNELS = ['trade', 'orderbook', 'ticker'] as const
const ASCENDEX_CHANNELS = ['trades', 'depth-realtime', 'depth-snapshot-realtime', 'bbo', 'futures-pricing-data'] as const
const DYDX_CHANNELS = ['v3_trades', 'v3_orderbook', 'v3_markets'] as const
const DYDX_V4_CHANNELS = ['v4_trades', 'v4_orderbook', 'v4_markets'] as const
const SERUM_CHANNELS = [
  'recent_trades',
  'trade',
  'quote',
  'l2snapshot',
  'l2update',
  'l3snapshot',
  'open',
  'fill',
  'change',
  'done'
] as const

const MANGO_CHANNELS = [
  'recent_trades',
  'trade',
  'quote',
  'l2snapshot',
  'l2update',
  'l3snapshot',
  'open',
  'fill',
  'change',
  'done'
] as const

const HUOBI_DM_OPTIONS_CHANNELS = ['trade', 'detail', 'depth', 'bbo', 'open_interest', 'option_market_index', 'option_index'] as const

const BYBIT_SPOT_CHANNELS = ['trade', 'bookTicker', 'depth', 'orderbook.1', 'orderbook.50', 'publicTrade', 'tickers', 'lt']

const CRYPTO_COM_CHANNELS = ['trade', 'book', 'ticker', 'settlement', 'index', 'mark', 'funding', 'estimatedfunding']

const CRYPTO_COM_DERIVATIVES = ['trade', 'book', 'ticker', 'settlement', 'index', 'mark', 'funding']

const KUCOIN_CHANNELS = ['market/ticker', 'market/snapshot', 'market/level2', 'market/match', 'market/level2Snapshot']

const BITNOMIAL_CHANNELS = ['trade', 'level', 'book', 'block', 'status']

const WOOX_CHANNELS = [
  'trade',
  'orderbook',
  'orderbookupdate',
  'ticker',
  'bbo',
  'indexprice',
  'markprice',
  'openinterest',
  'estfundingrate'
]

const BLOCKCHAIN_COM_CHANNELS = ['trades', 'l2', 'l3', 'ticker']
const BINANCE_EUROPEAN_OPTIONS_CHANNELS = ['trade', 'depth100', 'index', 'markPrice', 'ticker', 'openInterest']

const OKEX_SPREADS_CHANNELS = ['sprd-public-trades', 'sprd-bbo-tbt', 'sprd-books5', 'sprd-tickers']

const KUCOIN_FUTURES_CHANNELS = [
  'contractMarket/execution',
  'contractMarket/level2',
  'contractMarket/level2Snapshot',
  'contractMarket/tickerV2',
  'contract/instrument',
  'contract/details',
  'contractMarket/snapshot'
]

const BITGET_CHANNELS = ['trade', 'books1', 'books15']
const BITGET_FUTURES_CHANNELS = ['trade', 'books1', 'books15', 'ticker']
const COINBASE_INTERNATIONAL_CHANNELS = ['INSTRUMENTS', 'MATCH', 'FUNDING', 'RISK', 'LEVEL1', 'LEVEL2', 'CANDLES_ONE_MINUTE']

const HYPERLIQUID_CHANNELS = ['l2Book', 'trades', 'activeAssetCtx', 'activeSpotAssetCtx', 'bbo']

export const EXCHANGE_CHANNELS_INFO = {
  bitmex: BITMEX_CHANNELS,
  coinbase: COINBASE_CHANNELS,
  'coinbase-international': COINBASE_INTERNATIONAL_CHANNELS,
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
  ftx: FTX_CHANNELS,
  'ftx-us': FTX_US_CHANNELS,
  gemini: GEMINI_CHANNELS,
  bitflyer: BITFLYER_CHANNELS,
  'binance-futures': BINANCE_FUTURES_CHANNELS,
  'binance-delivery': BINANCE_DELIVERY_CHANNELS,
  'bitfinex-derivatives': BITFINEX_DERIV_CHANNELS,
  huobi: HUOBI_CHANNELS,
  'huobi-dm': HUOBI_DM_CHANNELS,
  'huobi-dm-swap': HUOBI_DM_SWAP_CHANNELS,
  'huobi-dm-linear-swap': HUOBI_DM_LINEAR_SWAP_CHANNELS,
  bybit: BYBIT_CHANNELS,
  'bybit-spot': BYBIT_SPOT_CHANNELS,
  'bybit-options': BYBIT_OPTIONS_CHANNELS,
  okcoin: OKCOIN_CHANNELS,
  hitbtc: HITBTC_CHANNELS,
  coinflex: COINFLEX_CHANNELS,
  phemex: PHEMEX_CHANNELS,
  delta: DELTA_CHANNELS,
  'gate-io': GATE_IO_CHANNELS,
  'gate-io-futures': GATE_IO_FUTURES_CHANNELS,
  poloniex: POLONIEX_CHANNELS,
  'binance-options': BINANCE_OPTIONS_CHANNELS,
  upbit: UPBIT_CHANNELS,
  ascendex: ASCENDEX_CHANNELS,
  dydx: DYDX_CHANNELS,
  'dydx-v4': DYDX_V4_CHANNELS,
  serum: SERUM_CHANNELS,
  'star-atlas': SERUM_CHANNELS,
  'huobi-dm-options': HUOBI_DM_OPTIONS_CHANNELS,
  mango: MANGO_CHANNELS,
  'crypto-com': CRYPTO_COM_CHANNELS,
  'crypto-com-derivatives': CRYPTO_COM_DERIVATIVES,
  kucoin: KUCOIN_CHANNELS,
  bitnomial: BITNOMIAL_CHANNELS,
  'woo-x': WOOX_CHANNELS,
  'blockchain-com': BLOCKCHAIN_COM_CHANNELS,
  'binance-european-options': BINANCE_EUROPEAN_OPTIONS_CHANNELS,
  'okex-spreads': OKEX_SPREADS_CHANNELS,
  'kucoin-futures': KUCOIN_FUTURES_CHANNELS,
  bitget: BITGET_CHANNELS,
  'bitget-futures': BITGET_FUTURES_CHANNELS,
  hyperliquid: HYPERLIQUID_CHANNELS
}
