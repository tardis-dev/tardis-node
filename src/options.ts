import { createRequire } from 'module'
import os from 'os'
import path from 'path'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json') as { version: string }

const defaultOptions: Options = {
  endpoint: 'https://api.tardis.dev/v1',
  datasetsEndpoint: 'https://datasets.tardis.dev/v1',
  cacheDir: path.join(os.tmpdir(), '.tardis-cache'),
  apiKey: '',
  _userAgent: `tardis-dev/${packageJson.version} (+https://github.com/tardis-dev/tardis-node)`
}

let options: Options = { ...defaultOptions }

export function init(initOptions: Partial<Options> = {}) {
  options = { ...defaultOptions, ...initOptions }
}

export function getOptions() {
  return options as Readonly<Options>
}

type Options = {
  endpoint: string
  datasetsEndpoint: string
  cacheDir: string
  apiKey: string
  _userAgent: string
}
