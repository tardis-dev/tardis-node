import { exchangeMappers, mapper } from '../src/mappers/registry.ts'

const originalNoRealTime = process.env.__NO_REAL_TIME__

afterEach(() => {
  if (originalNoRealTime === undefined) {
    delete process.env.__NO_REAL_TIME__
  } else {
    process.env.__NO_REAL_TIME__ = originalNoRealTime
  }
})

test('mapper chooses entries by strictly increasing until boundaries', () => {
  process.env.__NO_REAL_TIME__ = '1'

  const firstSwitch = new Date('2024-01-01T00:00:00.000Z')
  const secondSwitch = new Date('2024-02-01T00:00:00.000Z')
  const createMapper = mapper<any, any>([
    { until: firstSwitch, use: () => createTestMapper('before') },
    { until: secondSwitch, use: () => createTestMapper('middle') },
    { use: () => createTestMapper('after') }
  ])

  expect(createMapper(new Date('2023-12-31T23:59:59.999Z')).id).toBe('before')
  expect(createMapper(firstSwitch).id).toBe('middle')
  expect(createMapper(new Date('2024-01-31T23:59:59.999Z')).id).toBe('middle')
  expect(createMapper(secondSwitch).id).toBe('after')
  expect(createMapper.switchDates).toEqual([firstSwitch, secondSwitch])
})

test('mapper uses the last entry for realtime timestamps', () => {
  delete process.env.__NO_REAL_TIME__

  const createMapper = mapper<any, any>([
    { until: new Date('2999-01-01T00:00:00.000Z'), use: () => createTestMapper('historical') },
    { use: () => createTestMapper('realtime') }
  ])

  expect(createMapper(new Date()).id).toBe('realtime')
})

test('mapper uses the last entry when timestamp is omitted', () => {
  process.env.__NO_REAL_TIME__ = '1'

  const createMapper = mapper<any, any>([
    { until: new Date('2024-01-01T00:00:00.000Z'), use: () => createTestMapper('historical') },
    { use: () => createTestMapper('latest') }
  ])

  expect(createMapper().id).toBe('latest')
})

test('mapper rejects invalid ordering and shape', () => {
  const firstSwitch = new Date('2024-01-01T00:00:00.000Z')
  const secondSwitch = new Date('2024-02-01T00:00:00.000Z')

  expect(() => mapper<any, any>([])).toThrow('mapper requires at least one entry')
  expect(() => mapper<any, any>([{ use: () => createTestMapper('before') }, { use: () => createTestMapper('after') }])).toThrow(
    'only last mapper entry can omit until'
  )
  expect(() => mapper<any, any>([{ until: firstSwitch, use: () => createTestMapper('before') }])).toThrow(
    'last mapper entry must omit until'
  )
  expect(() =>
    mapper<any, any>([
      { until: secondSwitch, use: () => createTestMapper('before') },
      { until: firstSwitch, use: () => createTestMapper('middle') },
      { use: () => createTestMapper('after') }
    ])
  ).toThrow('mapper until dates must be strictly increasing')
  expect(() =>
    mapper<any, any>([
      { until: firstSwitch, use: () => createTestMapper('before') },
      { until: firstSwitch, use: () => createTestMapper('middle') },
      { use: () => createTestMapper('after') }
    ])
  ).toThrow('mapper until dates must be strictly increasing')
  expect(() =>
    mapper<any, any>([{ until: new Date('invalid'), use: () => createTestMapper('before') }, { use: () => createTestMapper('after') }])
  ).toThrow('mapper entry 0 has an invalid until date')
})

test('exchangeMappers accepts plain mapper factories', () => {
  const mappers = exchangeMappers({
    bitmex: {
      trades: () => createTestMapper('bitmex-trades')
    }
  })

  expect(mappers.bitmex.trades().id).toBe('bitmex-trades')
  expect(mappers.bitmex.trades.switchDates).toBeUndefined()
})

test('exchangeMappers rejects unsupported exchange keys', () => {
  expect(() =>
    exchangeMappers({
      pierdola: {
        trades: () => createTestMapper('invalid')
      }
    } as any)
  ).toThrow('Unsupported exchange mapper key: pierdola')
})

test('exchangeMappers rejects unsupported mapper keys', () => {
  expect(() =>
    exchangeMappers({
      bitmex: {
        bookChangers3: () => createTestMapper('invalid')
      }
    } as any)
  ).toThrow('Unsupported mapper key for bitmex: bookChangers3')
})

function createTestMapper(id: string) {
  return {
    id,
    canHandle: () => false,
    map: function* () {},
    getFilters: () => []
  } as any
}
