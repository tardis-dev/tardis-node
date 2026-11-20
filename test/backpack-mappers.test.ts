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

test('Backpack applies buffered updates to the snapshot and removes levels updated to zero', () => {
  const mapper = normalizeBookChanges('backpack', new Date())
  const updateTimestamp = new Date('2026-10-30T14:16:14Z')
  const snapshotTimestamp = new Date('2026-10-30T14:16:15Z')
  assert.deepEqual([...mapper.map({ ...depth(99, 100), data: { ...depth(99, 100).data, a: [['101', '9']] } }, updateTimestamp)!], [])
  // Recorded REST snapshots drop trailing zeros ("99") while depth keeps them ("99.00").
  assert.deepEqual(
    [...mapper.map({ ...depth(101, 102), data: { ...depth(101, 102).data, b: [['99.00', '0.000']] } }, updateTimestamp)!],
    []
  )
  const asks = [
    ['101.00', '5'],
    ['102.00', '4']
  ]
  assert.deepEqual([...mapper.map({ ...depth(103, 103), data: { ...depth(103, 103).data, b: [], a: asks } }, updateTimestamp)!], [])
  const messages = [...mapper.map(snapshot, snapshotTimestamp)!]
  // One snapshot holds the book after the buffered updates, at the snapshot's local time.
  assert.strictEqual(messages.length, 1)
  assert.strictEqual(messages[0].isSnapshot, true)
  assert.strictEqual(messages[0].localTimestamp, snapshotTimestamp)
  assert.deepEqual(messages[0].bids, [])
  assert.deepEqual(messages[0].asks, [
    { price: 101, amount: 5 },
    { price: 102, amount: 4 }
  ])
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
  assert.strictEqual(messages.length, 1)
  assert.deepEqual(messages[0].bids, [{ price: 99, amount: 2 }])
  assert.deepEqual([...mapper.map(depth(3101, 3101), localTimestamp)!].length, 1)
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

test('Backpack derivative output uses mark timestamps and caches zero values', () => {
  const mapper = normalizeDerivativeTickers('backpack', new Date())
  const map = (stream: string, data: object) => [...mapper.map({ stream, data: { s: 'BTC_USDC_PERP', ...data } }, new Date())!]
  assert.deepEqual(map('openInterest.BTC_USDC_PERP', { o: '0' }), [])
  assert.deepEqual(map('ticker.BTC_USDC_PERP', { c: '100', o: '90', E: timestamp + 1000 }), [])
  const [ticker] = map('markPrice.BTC_USDC_PERP', { p: '100', i: '101', f: '0', n: 1793372400000, E: timestamp })
  assert.strictEqual(ticker.openInterest, 0)
  assert.strictEqual(ticker.fundingRate, 0)
  assert.strictEqual(ticker.lastPrice, 100)
  assert.strictEqual(ticker.timestamp.valueOf(), Math.trunc(timestamp / 1000))
})

test('Backpack preserves requested symbols for derivative and liquidation filters', () => {
  for (const symbols of [[], ['BTC_USDC'], ['BTC_USDC', 'BTC_USDC_PERP', 'MU.US_USDC_PERP']]) {
    assert.deepEqual(normalizeDerivativeTickers('backpack', new Date()).getFilters(symbols), [
      { channel: 'markPrice', symbols },
      { channel: 'openInterest', symbols },
      { channel: 'ticker', symbols }
    ])
    assert.deepEqual(normalizeLiquidations('backpack', new Date()).getFilters(symbols), [{ channel: 'liquidation', symbols }])
  }
})

test('Backpack derivative routing depends on the channel rather than the symbol suffix', () => {
  const mapper = normalizeDerivativeTickers('backpack', new Date())
  for (const symbol of ['BTC_USDC', 'BTC_USDC_PERP', 'MU.US_USDC_PERP', 'FUTURE_SYMBOL']) {
    for (const channel of ['markPrice', 'openInterest', 'ticker']) {
      assert.strictEqual(mapper.canHandle({ stream: `${channel}.${symbol}` }), true)
    }
  }
  for (const stream of ['trade.BTC_USDC_PERP', 'bookTicker.BTC_USDC_PERP', 'markPriceOther.BTC_USDC_PERP', 'ticker']) {
    assert.strictEqual(mapper.canHandle({ stream }), false)
  }
})
