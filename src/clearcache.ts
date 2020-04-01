import { remove } from 'fs-extra'
import { debug } from './debug'
import { getOptions } from './options'
import { Filter, Exchange } from './types'
import { sha256, optimizeFilters, doubleDigit } from './handy'

export async function clearCache(exchange?: Exchange, filters?: Filter<any>[], year?: number, month?: number, day?: number) {
  try {
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

    debug('clearing cache dir: %s', dirToRemove)

    await remove(dirToRemove)

    debug('cleared cache dir: %s', dirToRemove)
  } catch (e) {
    debug('clearing cache dir error: %o', e)
  }
}
