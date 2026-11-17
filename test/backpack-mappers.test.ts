import { test } from 'node:test'
import { assert, errorMessageIncludes } from './assertions.ts'
import {
  normalizeBookChanges,
  normalizeBookTickers,
  normalizeDerivativeTickers,
  normalizeLiquidations,
  normalizeTrades
} from '../dist/index.js'

const timestamp = 1793369773514033

test('Backpack maps the recorded liquidation sell execution to sell', () => {
  // 2026-10-30: this fill matched a buyer-maker trade and removed the best bid at 3909.05.
  const message = {
    data: { E: 1793370107977000, S: 'Ask', T: 1793370107976615, e: 'liquidation', p: '3909.05', q: '0.0018', s: 'PAXG_USDC_PERP' },
    stream: 'liquidation.PAXG_USDC_PERP'
  }
  const localTimestamp = new Date('2026-10-30T14:21:48.103Z')
  const [liquidation] = [...normalizeLiquidations('backpack', localTimestamp).map(message, localTimestamp)!]

  assert.strictEqual(liquidation.side, 'sell')
  assert.strictEqual(liquidation.symbol, 'PAXG_USDC_PERP')
  assert.strictEqual(liquidation.price, 3909.05)
  assert.strictEqual(liquidation.amount, 0.0018)
  assert.strictEqual(liquidation.timestamp.valueOf(), 1793370107977)
  assert.strictEqual(liquidation.localTimestamp, localTimestamp)
})
const snapshot = {
  stream: 'depthSnapshot.MU.US_USDC_PERP',
  generated: true,
  data: { asks: [['101', '3']], bids: [['99', '1']], lastUpdateId: '100', timestamp }
}
function depth(U: number, u: number, amount = '2') {
  return { stream: 'depth.MU.US_USDC_PERP', data: { s: 'MU.US_USDC_PERP', U, u, E: timestamp + u, a: [], b: [['99', amount]] } }
}

test('Backpack aligns buffered updates without dropping their timestamps or deletion events', () => {
  const mapper = normalizeBookChanges('backpack', new Date())
  const updateTimestamp = new Date('2026-10-30T14:16:14Z')
  assert.deepEqual([...mapper.map(depth(99, 100), updateTimestamp)!], [])
  assert.deepEqual([...mapper.map(depth(101, 103, '0'), updateTimestamp)!], [])
  const messages = [...mapper.map(snapshot, new Date('2026-10-30T14:16:15Z'))!]
  assert.deepEqual(
    messages.map((message) => message.isSnapshot),
    [true, false]
  )
  assert.strictEqual(messages[1].localTimestamp, updateTimestamp)
  assert.deepEqual(messages[1].bids, [{ price: 99, amount: 0 }])
  assert.strictEqual(messages[0].timestamp.valueOf(), Math.trunc(timestamp / 1000))
  assert.strictEqual(messages[0].timestamp.μs, 33)
  assert.deepEqual([...mapper.map(snapshot, new Date())!], [])
  assert.throws(() => [...mapper.map(depth(105, 105), new Date())!], errorMessageIncludes('sequence gap'))
})

test('Backpack quiet books initialize, keep the boundary cursor and reset with a new mapper', () => {
  const mapper = normalizeBookChanges('backpack', new Date())
  assert.strictEqual([...mapper.map(snapshot, new Date())!][0].isSnapshot, true)
  assert.deepEqual([...mapper.map(depth(100, 100), new Date())!], [])
  assert.throws(() => [...mapper.map(depth(102, 102), new Date())!], errorMessageIncludes('sequence gap'))
  assert.strictEqual([...normalizeBookChanges('backpack', new Date()).map(snapshot, new Date())!][0].isSnapshot, true)
})

test('Backpack bounds pending updates and requires the snapshot to cover any discarded updates', () => {
  const mapper = normalizeBookChanges('backpack', new Date())
  const localTimestamp = new Date()
  for (let id = 101; id <= 3100; id++) {
    assert.deepEqual([...mapper.map(depth(id, id), localTimestamp)!], [])
  }
  assert.throws(() => [...mapper.map(snapshot, new Date())!], errorMessageIncludes('does not cover discarded'))
  const messages = [...mapper.map({ ...snapshot, data: { ...snapshot.data, lastUpdateId: '2100' } }, new Date())!]
  assert.strictEqual(messages.length, 1001)
  assert.ok(messages.slice(1).every((message) => message.localTimestamp === localTimestamp))
})

test('Backpack replay aligns against the snapshot without repeating recorder sequence validation', () => {
  const mapper = normalizeBookChanges('backpack', new Date('2026-10-30T14:16:00Z'))
  assert.strictEqual([...mapper.map(snapshot, new Date())!].length, 1)
  assert.strictEqual([...mapper.map(depth(105, 105), new Date())!].length, 1)
})

test('Backpack preserves native filter case, dotted symbols, maker-side inversion and microseconds', () => {
  const mapper = normalizeTrades('backpack', new Date())
  assert.deepEqual(mapper.getFilters(['kBONK_USDC_PERP']), [{ channel: 'trade', symbols: ['kBONK_USDC_PERP'] }])
  for (const m of [true, false]) {
    const [trade] = [
      ...mapper.map({ stream: 'trade.MU.US_USDC', data: { s: 'MU.US_USDC', t: 123, p: '99', q: '2', T: timestamp, m } }, new Date())!
    ]
    assert.strictEqual(trade.side, m ? 'sell' : 'buy')
    assert.strictEqual(trade.timestamp.μs, 33)
    assert.strictEqual(trade.id, '123')
  }
  const [quote] = [
    ...normalizeBookTickers('backpack', new Date()).map(
      { stream: 'bookTicker.MU.US_USDC', data: { s: 'MU.US_USDC', E: timestamp, a: null, A: null, b: '99', B: '0' } },
      new Date()
    )!
  ]
  assert.strictEqual(quote.askPrice, undefined)
  assert.strictEqual(quote.bidAmount, 0)
})

test('Backpack derivative output uses mark timestamps, caches zero values and excludes spot subscriptions', () => {
  const mapper = normalizeDerivativeTickers('backpack', new Date())
  assert.deepEqual(mapper.getFilters(['BTC_USDC']), [])
  assert.ok(mapper.getFilters(['BTC_USDC', 'BTC_USDC_PERP']).every((filter) => filter.symbols?.join() === 'BTC_USDC_PERP'))
  const map = (stream: string, data: object) => [...mapper.map({ stream, data: { s: 'BTC_USDC_PERP', ...data } }, new Date())!]
  assert.deepEqual(map('openInterest.BTC_USDC_PERP', { o: '0' }), [])
  assert.deepEqual(map('ticker.BTC_USDC_PERP', { c: '100', o: '90', E: timestamp + 1000 }), [])
  const [ticker] = map('markPrice.BTC_USDC_PERP', { p: '100', i: '101', f: '0', n: 1793372400000, E: timestamp })
  assert.strictEqual(ticker.openInterest, 0)
  assert.strictEqual(ticker.fundingRate, 0)
  assert.strictEqual(ticker.lastPrice, 100)
  assert.strictEqual(ticker.timestamp.valueOf(), Math.trunc(timestamp / 1000))
})
