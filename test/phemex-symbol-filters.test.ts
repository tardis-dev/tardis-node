import { normalizeBookChanges, normalizeDerivativeTickers, normalizeTrades } from '../src/index.ts'

const symbols = ['sBTCUSDT', 'SONYUSDT', 'BTCUSDC', 'cADAUSD', 'u1000BONKUSDT']
const perpetualPilotSymbols = [
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
]

test('Phemex filters preserve exchange-native symbols and select channels by market API', () => {
  expect(normalizeTrades('phemex').getFilters(symbols)).toEqual([
    { channel: 'trades_p', symbols: ['SONYUSDT', 'BTCUSDC', 'u1000BONKUSDT'] },
    { channel: 'trades', symbols: ['sBTCUSDT', 'cADAUSD'] }
  ])

  expect(normalizeBookChanges('phemex').getFilters(symbols)).toEqual([
    { channel: 'orderbook_p', symbols: ['SONYUSDT', 'BTCUSDC', 'u1000BONKUSDT'] },
    { channel: 'book', symbols: ['sBTCUSDT', 'cADAUSD'] }
  ])

  expect(normalizeDerivativeTickers('phemex').getFilters(symbols)).toEqual([
    { channel: 'perp_market24h_pack_p', symbols: ['SONYUSDT', 'BTCUSDC', 'u1000BONKUSDT'] },
    { channel: 'market24h', symbols: ['sBTCUSDT', 'cADAUSD'] }
  ])
})

test.each([
  ['SBTCUSDT', 'trades', 'sBTCUSDT'],
  ['sBTCUSDT', 'trades', 'sBTCUSDT'],
  ['SKHYUSDT', 'trades_p', 'SKHYUSDT'],
  ['SMCIUSDT', 'trades_p', 'SMCIUSDT'],
  ['SONYUSDT', 'trades_p', 'SONYUSDT'],
  ['SQQQUSDT', 'trades_p', 'SQQQUSDT'],
  ['STRCUSDT', 'trades_p', 'STRCUSDT'],
  ['U1000BONKUSDT', 'trades_p', 'u1000BONKUSDT'],
  ['u1000BONKUSDT', 'trades_p', 'u1000BONKUSDT'],
  ['CETHUSD', 'trades', 'cETHUSD'],
  ['cETHUSD', 'trades', 'cETHUSD'],
  ['SIRENPUSD', 'trades_p', 'SIRENPUSD'],
  ['sIRENPUSD', 'trades', 'sIRENPUSD'],
  ['COMPUSD', 'trades', 'COMPUSD']
])('Phemex trade filter maps %s to %s/%s', (inputSymbol, channel, apiSymbol) => {
  expect(normalizeTrades('phemex').getFilters([inputSymbol])).toEqual([{ channel, symbols: [apiSymbol] }])
})

test('Phemex filters use V2 channels for historical PerpetualPilot symbols only', () => {
  const legacySymbols = ['COMPUSD', 'OPUSD', 'sIRENPUSD']

  expect(normalizeTrades('phemex').getFilters([...perpetualPilotSymbols, ...legacySymbols])).toEqual([
    { channel: 'trades_p', symbols: perpetualPilotSymbols },
    { channel: 'trades', symbols: legacySymbols }
  ])
})
