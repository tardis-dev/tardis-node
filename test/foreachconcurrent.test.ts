import { test } from 'node:test'
import { assert } from './assertions.ts'
import { forEachConcurrent } from '../dist/foreachconcurrent.js'

test('processes an iterable with bounded concurrency', async () => {
  let active = 0
  let maxActive = 0
  const processed: number[] = []

  await forEachConcurrent([1, 2, 3, 4, 5], 2, async (item) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await Promise.resolve()
    processed.push(item)
    active -= 1
  })

  assert.strictEqual(maxActive, 2)
  assert.deepStrictEqual(
    processed.sort((a, b) => a - b),
    [1, 2, 3, 4, 5]
  )
})

test('stops scheduling work after an action fails', async () => {
  const started: number[] = []
  let inFlightFinished = false

  await assert.rejects(
    forEachConcurrent([1, 2, 3], 2, async (item) => {
      started.push(item)
      if (item === 2) {
        throw new Error('action failed')
      }
      await new Promise((resolve) => setImmediate(resolve))
      inFlightFinished = true
    }),
    /action failed/
  )

  assert.deepStrictEqual(started, [1, 2])
  assert.strictEqual(inFlightFinished, true)
})
