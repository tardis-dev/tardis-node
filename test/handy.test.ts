import { parseμs } from '../dist/handy.js'

describe('parseμs', () => {
  test.each([
    ['2019-06-01T00:03:03.123878Z', 878],
    ['2019-06-01T00:03:03.1238784Z', 878],
    ['2020-03-01T00:00:24.893456+00:00', 456],
    [valueWithMicroseconds(30, '321'), 321],
    [valueWithMicroseconds(27, ' 12'), 12],
    ['2020-03-01T00:00:24.893Z', 0]
  ])('preserves the legacy result for %s', (value, expected) => {
    expect(parseμs(value)).toBe(expected)
  })

  test('preserves NaN for a supported-length value with a non-numeric microsecond suffix', () => {
    expect(parseμs(valueWithMicroseconds(28, '12x'))).toBeNaN()
  })
})

function valueWithMicroseconds(length: number, microseconds: string) {
  return 'x'.repeat(23) + microseconds + 'x'.repeat(length - 26)
}
