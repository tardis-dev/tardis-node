import { remove, removeSync } from 'fs-extra'
import { debug } from './debug'
import { getOptions } from './options'
import { Filter, Exchange } from './types'
import { sha256, optimizeFilters, doubleDigit } from './handy'

export async function clearCache(exchange?: Exchange, filters?: Filter<any>[], year?: number, month?: number, day?: number) {
  try {
    const dirToRemove = getDirToRemove(exchange, filters, year, month, day)

    debug('clearing cache dir: %s', dirToRemove)

    await remove(dirToRemove)

    debug('cleared cache dir: %s', dirToRemove)
  } catch (e) {
    debug('clearing cache dir error: %o', e)
  }
}

export function clearCacheSync(exchange?: Exchange, filters?: Filter<any>[], year?: number, month?: number, day?: number) {
  try {
    const dirToRemove = getDirToRemove(exchange, filters, year, month, day)

    debug('clearing cache (sync) dir: %s', dirToRemove)

    removeSync(dirToRemove)

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
