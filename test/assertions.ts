import assert from 'node:assert/strict'
import path from 'node:path'
import { afterEach, beforeEach, snapshot as snapshotConfiguration, type TestContext } from 'node:test'

export { assert }

const originalToISOString = Date.prototype.toISOString
const undefinedSnapshotValue = '__TARDIS_NODE_SNAPSHOT_UNDEFINED__'

snapshotConfiguration.setDefaultSnapshotSerializers([
  (value) => JSON.stringify(snapshotValue(value), undefined, 2).replaceAll(`"${undefinedSnapshotValue}"`, 'undefined')
])

snapshotConfiguration.setResolveSnapshotPath((testFilePath) => {
  if (testFilePath === undefined) {
    throw new Error('Cannot resolve snapshot path without a test file path')
  }

  const testName = path.basename(testFilePath, '.ts')
  return path.join(process.cwd(), 'test', '__snapshots__', `${testName}.snapshot`)
})

let currentTest: TestContext | undefined

beforeEach((context) => {
  if ('assert' in context) {
    currentTest = context
  }
})

afterEach(() => {
  currentTest = undefined
})

export function snapshot(value: unknown) {
  if (currentTest === undefined) {
    throw new Error('Snapshots can only be created inside a test')
  }
  currentTest.assert.snapshot(value)
}

export function errorMessageIncludes(expected: string) {
  return (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.ok(
      error.message.includes(expected),
      `Expected error message to include ${JSON.stringify(expected)}, received ${JSON.stringify(error.message)}`
    )
    return true
  }
}

function snapshotValue(value: unknown): unknown {
  if (value === undefined) {
    return undefinedSnapshotValue
  }

  if (value instanceof Date) {
    const isoTimestamp = originalToISOString.call(value)
    const microseconds = (value as Date & { μs?: number }).μs
    return microseconds === undefined ? isoTimestamp : isoTimestamp.slice(0, -1) + String(microseconds).padStart(3, '0') + 'Z'
  }

  if (Array.isArray(value)) {
    return value.map(snapshotValue)
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, snapshotValue(entry)]))
  }

  return value
}
