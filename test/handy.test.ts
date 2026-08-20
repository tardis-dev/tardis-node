import { test } from 'node:test'
import { assert } from './assertions.ts'
import { parseμs } from '../dist/handy.js'

test('parses microseconds from supported exchange timestamp formats', () => {
  assert.strictEqual(parseμs('2019-06-01T00:03:03.123878Z'), 878)
  assert.strictEqual(parseμs('2019-06-01T00:03:03.1238784Z'), 878)
  assert.strictEqual(parseμs('2020-03-01T00:00:24.893456+00:00'), 456)
  assert.strictEqual(parseμs('2020-03-01T00:00:24.893Z'), 0)
})
