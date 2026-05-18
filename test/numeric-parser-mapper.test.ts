import { asNonZeroNumberOrUndefined, asNumberOrUndefined } from '../src/handy.ts'

describe('numeric parser contracts', () => {
  test('optional numeric helpers preserve only the zero behavior their names describe', () => {
    expect(asNumberOrUndefined(0)).toBe(0)
    expect(asNumberOrUndefined('0')).toBe(0)
    expect(asNumberOrUndefined(Number.NaN)).toBeUndefined()
    expect(asNumberOrUndefined('')).toBeUndefined()

    expect(asNonZeroNumberOrUndefined(0)).toBeUndefined()
    expect(asNonZeroNumberOrUndefined('0')).toBeUndefined()
    expect(asNonZeroNumberOrUndefined('0.0')).toBeUndefined()
    expect(asNonZeroNumberOrUndefined('')).toBeUndefined()
    expect(asNonZeroNumberOrUndefined('1.25')).toBe(1.25)
  })
})
