import { wait } from '../handy.ts'

export function parseRequestWeightHeader(headerValue: string | undefined) {
  if (headerValue === undefined) {
    return undefined
  }

  const parsed = Number.parseInt(headerValue, 10)

  return Number.isFinite(parsed) ? parsed : undefined
}

export function getExchangeScopedNumberEnv(exchange: string, suffix: string, fallback: number) {
  const envName = `${exchange.toUpperCase().replace(/-/g, '_')}_${suffix}`
  const rawValue = process.env[envName]

  if (rawValue === undefined) {
    return fallback
  }

  const parsed = Number.parseInt(rawValue, 10)

  return Number.isFinite(parsed) ? parsed : fallback
}

export function getRequestWeightLimit(exchange: string, exchangeInfo: any) {
  const configuredLimit = getExchangeScopedNumberEnv(exchange, 'REQUEST_WEIGHT_LIMIT', 0)
  if (configuredLimit > 0) {
    return configuredLimit
  }

  const requestWeightLimit = exchangeInfo.rateLimits.find((d: any) => d.rateLimitType === 'REQUEST_WEIGHT')?.limit as number | undefined

  if (!requestWeightLimit) {
    throw new Error(`Failed to determine ${exchange} REQUEST_WEIGHT limit`)
  }

  return requestWeightLimit
}

export class RequestWeightLimiter {
  constructor(
    readonly limit: number,
    readonly minAvailableWeightBuffer: number,
    private _usedWeight = 0
  ) {}

  get usedWeight() {
    return this._usedWeight
  }

  get availableWeight() {
    return this.limit > 0 ? this.limit - this._usedWeight - this.minAvailableWeightBuffer : Infinity
  }

  async waitForAvailableWeight(requestWeight: number, onWait?: (delayMS: number) => void) {
    const maxAvailableWeight = this.limit - this.minAvailableWeightBuffer
    if (this.limit > 0 && requestWeight > maxAvailableWeight) {
      throw new Error(`Request weight ${requestWeight} exceeds the available per-minute limit ${maxAvailableWeight}`)
    }

    if (this.availableWeight >= requestWeight) {
      return false
    }

    const delayMS = getDelayToNextMinuteMS()
    onWait?.(delayMS)
    await wait(delayMS)

    this._usedWeight = 0

    return true
  }

  updateUsedWeight(usedWeight: number | undefined, fallbackIncrement: number) {
    if (usedWeight !== undefined) {
      this._usedWeight = usedWeight
      return
    }

    if (this.limit > 0 && fallbackIncrement > 0) {
      this._usedWeight += fallbackIncrement
    }
  }
}

function getDelayToNextMinuteMS() {
  const now = new Date()

  return Math.max((61 - now.getUTCSeconds()) * 1000 - now.getUTCMilliseconds(), 1)
}
