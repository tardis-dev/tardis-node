import { describe, test } from 'node:test'
import { asNonZeroNumberOrUndefined, asNumberOrUndefined } from '../dist/handy.js'
import { assert } from './assertions.ts'

describe('numeric parser contracts', () => {
  test('optional numeric helpers preserve only the zero behavior their names describe', () => {
    assert.strictEqual(asNumberOrUndefined(0), 0)
    assert.strictEqual(asNumberOrUndefined('0'), 0)
    assert.strictEqual(asNumberOrUndefined(Number.NaN), undefined)
    assert.strictEqual(asNumberOrUndefined(''), undefined)

    assert.strictEqual(asNonZeroNumberOrUndefined(0), undefined)
    assert.strictEqual(asNonZeroNumberOrUndefined('0'), undefined)
    assert.strictEqual(asNonZeroNumberOrUndefined('0.0'), undefined)
    assert.strictEqual(asNonZeroNumberOrUndefined(''), undefined)
    assert.strictEqual(asNonZeroNumberOrUndefined('1.25'), 1.25)
  })
})
