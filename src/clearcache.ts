import { rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { debug } from './debug.ts'
import { getOptions } from './options.ts'
import { Filter, Exchange } from './types.ts'
import { sha256, optimizeFilters, doubleDigit } from './handy.ts'

export async function clearCache(exchange?: Exchange, filters?: Filter<any>[], year?: number, month?: number, day?: number) {
  try {
    const dirToRemove = getDirToRemove(exchange, filters, year, month, day)

    debug('clearing cache dir: %s', dirToRemove)

    await rm(dirToRemove, { force: true, recursive: true })

    debug('cleared cache dir: %s', dirToRemove)
  } catch (e) {
    debug('clearing cache dir error: %o', e)
  }
}

export function clearCacheSync(exchange?: Exchange, filters?: Filter<any>[], year?: number, month?: number, day?: number) {
  try {
    const dirToRemove = getDirToRemove(exchange, filters, year, month, day)

    debug('clearing cache (sync) dir: %s', dirToRemove)

    rmSync(dirToRemove, { force: true, recursive: true })

    debug('cleared cache(sync) dir: %s', dirToRemove)
  } catch (e) {
    debug('clearing cache (sync) dir error: %o', e)
  }
}

function getDirToRemove(exchange?: Exchange, filters?: Filter<any>[], year?: number, month?: number, day?: number) {
  const options = getOptions()

  let dirToRemove = `${options.cacheDir}/feeds`

  if (exchange !== undefined) {
    dirToRemove += `/${exchange}`
  }

  if (filters !== undefined) {
    dirToRemove += `/${sha256(optimizeFilters(filters))}`
  }

  if (year !== undefined) {
    dirToRemove += `/${year}`
  }

  if (month !== undefined) {
    dirToRemove += `/${doubleDigit(month)}`
  }

  if (day !== undefined) {
    dirToRemove += `/${doubleDigit(day)}`
  }

  return dirToRemove
}
