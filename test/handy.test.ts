import { test } from 'node:test'
import { assert } from './assertions.ts'
import { parseμs } from '../dist/handy.js'

test('parses microseconds from supported exchange timestamp formats', () => {
  assert.strictEqual(parseμs('2019-06-01T00:03:03.123878Z'), 878)
  assert.strictEqual(parseμs('2019-06-01T00:03:03.1238784Z'), 878)
  assert.strictEqual(parseμs('2020-03-01T00:00:24.893456+00:00'), 456)
  assert.strictEqual(parseμs('2020-03-01T00:00:24.893Z'), 0)
})

test('preserves variable-width ISO fractions through microsecond precision', () => {
  const fractions = [
    ['', 0, '000'],
    ['.5', 0, '500'],
    ['.57', 0, '570'],
    ['.571', 0, '571'],
    ['.5711', 100, '571'],
    ['.57116', 160, '571'],
    ['.571160', 160, '571'],
    ['.5711607', 160, '571'],
    ['.57116078', 160, '571'],
    ['.571160789', 160, '571'],
    ['.000001', 1, '000'],
    ['.999999999', 999, '999']
  ] as const

  for (const [fraction, microseconds, milliseconds] of fractions) {
    for (const [offset, utcHour] of [
      ['Z', '06'],
      ['+00:00', '06'],
      ['+02:00', '04'],
      ['-02:00', '08']
    ]) {
      const input = `2026-10-08T06:51:16${fraction}${offset}`
      assert.strictEqual(parseμs(input), microseconds, input)
      const parsed = new Date(input)
      parsed.μs = parseμs(input)
      assert.strictEqual(parsed.toISOString(), `2026-10-08T${utcHour}:51:16.${milliseconds}Z`, input)
      assert.strictEqual(parsed.μs, microseconds, input)
    }
  }
})
