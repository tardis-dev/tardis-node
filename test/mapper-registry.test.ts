import { afterEach, describe, test } from 'node:test'
import { assert } from './assertions.ts'
import { exchangeMappers, isRealTime, mapper } from '../dist/mappers/registry.js'

const originalNoRealTime = process.env.__NO_REAL_TIME__

describe('mapper registry', () => {
  afterEach(() => {
    if (originalNoRealTime === undefined) {
      delete process.env.__NO_REAL_TIME__
    } else {
      process.env.__NO_REAL_TIME__ = originalNoRealTime
    }
  })

  test('selects mappers at switch boundaries and exposes the switch dates', () => {
    process.env.__NO_REAL_TIME__ = '1'

    const firstSwitch = new Date('2024-01-01T00:00:00.000Z')
    const secondSwitch = new Date('2024-02-01T00:00:00.000Z')
    const createMapper = mapper<any, any>([
      { until: firstSwitch, use: () => createTestMapper('before') },
      { until: secondSwitch, use: () => createTestMapper('middle') },
      { use: () => createTestMapper('after') }
    ])

    assert.strictEqual(mapperId(createMapper(new Date('2023-12-31T23:59:59.999Z'))), 'before')
    assert.strictEqual(mapperId(createMapper(firstSwitch)), 'middle')
    assert.strictEqual(mapperId(createMapper(new Date('2024-01-31T23:59:59.999Z'))), 'middle')
    assert.strictEqual(mapperId(createMapper(secondSwitch)), 'after')
    assert.deepStrictEqual(createMapper.switchDates, [firstSwitch, secondSwitch])
  })

  test('uses timestamps for recorded versions and omits them for the latest version', () => {
    delete process.env.__NO_REAL_TIME__

    const createMapper = mapper<any, any>([
      { until: new Date('2999-01-01T00:00:00.000Z'), use: () => createTestMapper('historical') },
      { use: () => createTestMapper('latest') }
    ])

    assert.strictEqual(mapperId(createMapper(new Date())), 'historical')
    assert.strictEqual(mapperId(createMapper()), 'latest')
  })

  test('replay selects by timestamp even for recent or future data', (context) => {
    delete process.env.__NO_REAL_TIME__
    context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-29T23:59:00Z') })
    const cutover = new Date('2026-11-30T00:00:00Z')
    const createMapper = mapper<any, any>([
      { until: cutover, use: () => createTestMapper('legacy') },
      { use: () => createTestMapper('protobuf') }
    ])

    assert.strictEqual(mapperId(createMapper(new Date('2026-11-29T23:58:00Z'))), 'legacy')
    assert.strictEqual(mapperId(createMapper(new Date('2026-11-29T23:59:59.999Z'))), 'legacy')
    assert.strictEqual(mapperId(createMapper(cutover)), 'protobuf')
    assert.strictEqual(mapperId(createMapper(new Date('2026-11-30T00:00:00.001Z'))), 'protobuf')
    assert.strictEqual(mapperId(createMapper()), 'protobuf')
  })

  test('only actual recent timestamps are classified as real time', (context) => {
    context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-29T23:59:00Z') })
    delete process.env.__NO_REAL_TIME__
    assert.strictEqual(isRealTime(), false)
    assert.strictEqual(isRealTime(new Date()), true)
    process.env.__NO_REAL_TIME__ = '1'
    assert.strictEqual(isRealTime(), false)
  })

  test('rejects invalid mapper switch definitions', () => {
    const firstSwitch = new Date('2024-01-01T00:00:00.000Z')
    const secondSwitch = new Date('2024-02-01T00:00:00.000Z')

    assert.throws(() => mapper<any, any>([]), /mapper requires at least one entry/)
    assert.throws(
      () => mapper<any, any>([{ use: () => createTestMapper('before') }, { use: () => createTestMapper('after') }]),
      /only last mapper entry can omit until/
    )
    assert.throws(
      () => mapper<any, any>([{ until: firstSwitch, use: () => createTestMapper('before') }]),
      /last mapper entry must omit until/
    )
    assert.throws(
      () =>
        mapper<any, any>([
          { until: secondSwitch, use: () => createTestMapper('before') },
          { until: firstSwitch, use: () => createTestMapper('middle') },
          { use: () => createTestMapper('after') }
        ]),
      /mapper until dates must be strictly increasing/
    )
    assert.throws(
      () =>
        mapper<any, any>([{ until: new Date('invalid'), use: () => createTestMapper('before') }, { use: () => createTestMapper('after') }]),
      /mapper entry 0 has an invalid until date/
    )
  })

  test('accepts supported factories and rejects unknown registry keys', () => {
    const mappers = exchangeMappers({
      bitmex: {
        trades: () => createTestMapper('bitmex-trades')
      }
    })

    assert.strictEqual(mapperId(mappers.bitmex.trades()), 'bitmex-trades')
    assert.strictEqual(mappers.bitmex.trades.switchDates, undefined)
    assert.throws(
      () => exchangeMappers({ unknown: { trades: () => createTestMapper('invalid') } } as any),
      /Unsupported exchange mapper key: unknown/
    )
    assert.throws(
      () => exchangeMappers({ bitmex: { unknown: () => createTestMapper('invalid') } } as any),
      /Unsupported mapper key for bitmex: unknown/
    )
  })
})

function createTestMapper(id: string) {
  return {
    id,
    canHandle: () => false,
    map: function* () {},
    getFilters: () => []
  } as any
}

function mapperId(value: unknown) {
  return (value as { id: string }).id
}
