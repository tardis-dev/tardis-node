import { remove } from 'fs-extra'
import { debug } from './debug'
import { getOptions } from './options'

export async function clearCache() {
  const options = getOptions()
  const dirToRemove = `${options.cacheDir}`

  try {
    debug('clearing cache dir: %s', dirToRemove)

    await remove(dirToRemove)

    debug('cleared cache dir: %s', dirToRemove)
  } catch (e) {
    debug('clearing cache dir error: %o', e)
  }
}
