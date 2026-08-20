import { describe, test } from 'node:test'
import { createNormalizedSymbolFilter } from '../dist/handy.js'
import { assert } from './assertions.ts'
import type { Filter } from '../dist/types.js'

describe('createNormalizedSymbolFilter', () => {
  test('preserves mixed-case exchange symbols while matching normalized aliases', () => {
    const filters: Filter<string>[] = [{ channel: 'trade', symbols: ['AAPLX/USD'] }]
    const filter = createNormalizedSymbolFilter(['AAPLx/USD'], filters)

    assert.strictEqual(filter?.('AAPLx/USD'), true)
    assert.strictEqual(filter?.('AAPLX/USD'), true)
    assert.strictEqual(filter?.('aaplx/usd'), false)
    assert.strictEqual(filter?.('MSFTx/USD'), false)

    const translatedFilter = createNormalizedSymbolFilter(['aaplx/usd'], [{ channel: 'trade', symbols: ['AAPLx/USD'] }])
    assert.strictEqual(translatedFilter?.('AAPLx/USD'), true)

    assert.strictEqual(createNormalizedSymbolFilter(undefined, []), undefined)
    assert.strictEqual(createNormalizedSymbolFilter([], []), undefined)
  })
})
