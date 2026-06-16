import { EXCHANGES } from '../consts.ts'
import { ONE_SEC_IN_MS } from '../handy.ts'
import { Exchange, NormalizedData } from '../types.ts'
import { Mapper } from './mapper.ts'

const THREE_MINUTES_IN_MS = 3 * 60 * ONE_SEC_IN_MS

export type MapperCreator<T extends Exchange = any, U extends NormalizedData = NormalizedData> = ((
  localTimestamp?: Date
) => Mapper<T, U>) & {
  switchDates?: readonly Date[]
}
export type MapperCollection = Record<string, MapperCreator>
export type MapperFactory<T extends Exchange = any, U extends NormalizedData = NormalizedData> = (localTimestamp?: Date) => Mapper<T, U>
export type MapperDefinition<T extends Exchange = any, U extends NormalizedData = NormalizedData> =
  | MapperCreator<T, U>
  | MapperFactory<T, U>
export type ExchangeMapperDefinitions = Partial<Record<MapperKind, MapperDefinition>>
export type ExchangeMappers = Partial<Record<Exchange, Partial<Record<MapperKind, MapperCreator>>>>
export type ExchangeMapperDefinitionMap = Partial<Record<Exchange, ExchangeMapperDefinitions>>
type OnlyExchangeKeys<M> = M & Record<Exclude<keyof M, Exchange>, never>
type OnlyMapperKindKeys<M> = {
  [ExchangeName in keyof M]: M[ExchangeName] & Record<Exclude<keyof M[ExchangeName], MapperKind>, never>
}

export type MapperEntry<T extends Exchange, U extends NormalizedData> = {
  until?: Date
  use: (localTimestamp?: Date) => Mapper<T, U>
}

export type MapperKind = 'trades' | 'bookChanges' | 'derivativeTickers' | 'optionsSummary' | 'liquidations' | 'bookTickers'

export const MAPPER_KINDS: readonly MapperKind[] = [
  'trades',
  'bookChanges',
  'derivativeTickers',
  'optionsSummary',
  'liquidations',
  'bookTickers'
]

type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer U) => void ? U : never

type MapperForKind<Mappers, Kind extends MapperKind> = Kind extends keyof Mappers ? Mappers[Kind] : never

type DefinitionMapperCollection<Definition extends ExchangeMappers, Kind extends MapperKind> = {
  [ExchangeName in keyof Definition as MapperForKind<Definition[ExchangeName], Kind> extends MapperCreator ? ExchangeName : never]: Extract<
    MapperForKind<Definition[ExchangeName], Kind>,
    MapperCreator
  >
}

type MergedExchangeMappers<Definitions extends readonly ExchangeMappers[]> = {
  [Kind in MapperKind]: UnionToIntersection<
    Definitions[number] extends infer Definition
      ? Definition extends ExchangeMappers
        ? DefinitionMapperCollection<Definition, Kind>
        : never
      : never
  >
}

export const isRealTime = (date?: Date) => {
  if (process.env.__NO_REAL_TIME__) {
    return false
  }
  if (date === undefined) {
    return false
  }
  return date.valueOf() + THREE_MINUTES_IN_MS > new Date().valueOf()
}

export function mapper<T extends Exchange, U extends NormalizedData>(entry: MapperEntry<T, U>): MapperCreator<T, U>
export function mapper<T extends Exchange, U extends NormalizedData>(entries: readonly MapperEntry<T, U>[]): MapperCreator<T, U>
export function mapper<T extends Exchange, U extends NormalizedData>(
  entryOrEntries: MapperEntry<T, U> | readonly MapperEntry<T, U>[]
): MapperCreator<T, U> {
  const entries = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries]
  validateMapperEntries(entries)

  const createMapper = ((localTimestamp?: Date) => {
    if (localTimestamp === undefined || isRealTime(localTimestamp)) {
      return entries[entries.length - 1].use(localTimestamp)
    }

    for (const entry of entries) {
      if (entry.until === undefined || localTimestamp.valueOf() < entry.until.valueOf()) {
        return entry.use(localTimestamp)
      }
    }

    return entries[entries.length - 1].use(localTimestamp)
  }) as MapperCreator<T, U>

  createMapper.switchDates = entries.flatMap((entry) => (entry.until === undefined ? [] : [entry.until]))
  return createMapper
}

export function exchangeMappers<M extends ExchangeMapperDefinitionMap>(
  definition: OnlyExchangeKeys<M> & OnlyMapperKindKeys<M>
): NormalizeExchangeMappers<M> {
  validateExchangeMapperKeys(definition)

  const normalized: ExchangeMappers = {}
  for (const [exchange, mappers] of Object.entries(definition) as [Exchange, ExchangeMapperDefinitions][]) {
    normalized[exchange] = {}

    for (const kind of MAPPER_KINDS) {
      const createMapper = mappers[kind]
      if (createMapper !== undefined) {
        normalized[exchange][kind] = createMapper as MapperCreator
      }
    }
  }

  return normalized as NormalizeExchangeMappers<M>
}

export function mergeExchangeMappers<Definitions extends readonly ExchangeMappers[]>(
  ...definitions: Definitions
): MergedExchangeMappers<Definitions> {
  const merged = MAPPER_KINDS.reduce(
    (result, kind) => {
      result[kind] = {}
      return result
    },
    {} as Record<MapperKind, MapperCollection>
  )

  for (const definition of definitions) {
    for (const [exchange, mappers] of Object.entries(definition)) {
      for (const kind of MAPPER_KINDS) {
        const createMapper = mappers[kind]
        if (createMapper !== undefined) {
          merged[kind][exchange] = createMapper
        }
      }
    }
  }

  return merged as MergedExchangeMappers<Definitions>
}

function validateMapperEntries<T extends Exchange, U extends NormalizedData>(entries: readonly MapperEntry<T, U>[]) {
  if (entries.length === 0) {
    throw new Error('mapper requires at least one entry')
  }

  let previousUntil: Date | undefined
  for (let i = 0; i < entries.length; i++) {
    const { until, use } = entries[i]

    if (typeof use !== 'function') {
      throw new Error(`mapper entry ${i} requires a use function`)
    }

    if (i === entries.length - 1) {
      if (until !== undefined) {
        throw new Error('last mapper entry must omit until')
      }
      continue
    }

    if (until === undefined) {
      throw new Error('only last mapper entry can omit until')
    }

    if (until instanceof Date === false || Number.isFinite(until.valueOf()) === false) {
      throw new Error(`mapper entry ${i} has an invalid until date`)
    }

    if (previousUntil !== undefined && previousUntil.valueOf() >= until.valueOf()) {
      throw new Error('mapper until dates must be strictly increasing')
    }

    previousUntil = until
  }
}

type NormalizeExchangeMappers<M extends ExchangeMapperDefinitionMap> = {
  [ExchangeName in keyof M]: {
    [Kind in keyof M[ExchangeName]]: Extract<M[ExchangeName][Kind], MapperDefinition> extends MapperDefinition<infer T, infer U>
      ? MapperCreator<T, U>
      : never
  }
}

const exchangeIds = new Set<string>(EXCHANGES)
const mapperKindIds = new Set<string>(MAPPER_KINDS)

function validateExchangeMapperKeys(definition: ExchangeMapperDefinitionMap) {
  for (const [exchange, mappers] of Object.entries(definition)) {
    if (exchangeIds.has(exchange) === false) {
      throw new Error(`Unsupported exchange mapper key: ${exchange}`)
    }

    for (const kind of Object.keys(mappers ?? {})) {
      if (mapperKindIds.has(kind) === false) {
        throw new Error(`Unsupported mapper key for ${exchange}: ${kind}`)
      }
    }
  }
}
