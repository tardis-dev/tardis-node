import { test } from 'node:test'
import { normalizeBookChanges, normalizeDerivativeTickers, normalizeTrades } from '../dist/index.js'
import { snapshot } from './assertions.ts'

const symbols = ['sBTCUSDT', 'SONYUSDT', 'BTCUSDC', 'cADAUSD', 'u1000BONKUSDT']
const localTimestamp = new Date('2026-01-01T00:00:00.000Z')
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

test('snapshots Phemex routing for ambiguous symbol families', () => {
  const legacySymbols = ['COMPUSD', 'OPUSD', 'sIRENPUSD']

  snapshot({
    channelFamilies: {
      trades: normalizeTrades('phemex', localTimestamp).getFilters(symbols),
      bookChanges: normalizeBookChanges('phemex', localTimestamp).getFilters(symbols),
      derivativeTickers: normalizeDerivativeTickers('phemex', localTimestamp).getFilters(symbols)
    },
    aliases: [
      'SBTCUSDT',
      'sBTCUSDT',
      'SKHYUSDT',
      'SMCIUSDT',
      'SONYUSDT',
      'SQQQUSDT',
      'STRCUSDT',
      'U1000BONKUSDT',
      'u1000BONKUSDT',
      'CETHUSD',
      'cETHUSD',
      'SIRENPUSD',
      'sIRENPUSD',
      'COMPUSD'
    ].map((symbol) => ({ symbol, filters: normalizeTrades('phemex', localTimestamp).getFilters([symbol]) })),
    historicalPerpetualPilot: normalizeTrades('phemex', localTimestamp).getFilters([...perpetualPilotSymbols, ...legacySymbols])
  })
})
