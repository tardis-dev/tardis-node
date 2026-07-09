import { createNormalizedSymbolFilter } from '../src/handy.ts'
import { Filter } from '../src/types.ts'

describe('createNormalizedSymbolFilter', () => {
  test('keeps exact mixed-case symbols and uppercase aliases', () => {
    const filters: Filter<string>[] = [{ channel: 'trade', symbols: ['AAPLX/USD'] }]
    const filter = createNormalizedSymbolFilter(['AAPLx/USD'], filters)

    expect(filter?.('AAPLx/USD')).toBe(true)
    expect(filter?.('AAPLX/USD')).toBe(true)
    expect(filter?.('MSFTx/USD')).toBe(false)
  })

  test('keeps mapper-translated mixed-case symbols', () => {
    const filters: Filter<string>[] = [{ channel: 'trade', symbols: ['AAPLx/USD'] }]
    const filter = createNormalizedSymbolFilter(['aaplx/usd'], filters)

    expect(filter?.('AAPLx/USD')).toBe(true)
  })

  test('does not filter when symbols are omitted', () => {
    expect(createNormalizedSymbolFilter(undefined, [])).toBeUndefined()
    expect(createNormalizedSymbolFilter([], [])).toBeUndefined()
  })
})
