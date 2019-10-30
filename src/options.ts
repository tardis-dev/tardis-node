import os from 'os'
import path from 'path'
import { debug } from './debug'

const defaultOptions: Options = {
  endpoint: 'https://tardis.dev/api',
  cacheDir: path.join(os.tmpdir(), '.tardis-cache'),
  apiKey: ''
}

let options: Options = { ...defaultOptions }

export function init(initOptions: Partial<Options> = {}) {
  options = { ...defaultOptions, ...initOptions }

  debug('initialized with: %o', options)
}

export function getOptions() {
  return options as Readonly<Options>
}

type Options = {
  endpoint: string
  cacheDir: string
  apiKey: string
}
