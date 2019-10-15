import { createHash } from 'crypto'

export function parseAsUTCDate(val: string) {
  // not sure about this one, but it should force parsing date as UTC date not as local timezone
  if (val.endsWith('Z') === false) {
    val += 'Z'
  }
  var date = new Date(val)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()))
}

export function wait(delayMS: number) {
  return new Promise(resolve => {
    setTimeout(resolve, delayMS)
  })
}

export function formatDateToPath(date: Date) {
  const year = date.getUTCFullYear()
  const month = doubleDigit(date.getUTCMonth() + 1)
  const day = doubleDigit(date.getUTCDate())
  const hour = doubleDigit(date.getUTCHours())
  const minute = doubleDigit(date.getUTCMinutes())

  return `${year}/${month}/${day}/${hour}/${minute}`
}

function doubleDigit(input: number) {
  return input < 10 ? '0' + input : '' + input
}

export function sha256(obj: object) {
  return createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex')
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000)
}

export function* sequence(end: number, seed = 0) {
  let current = seed
  while (current < end) {
    yield current
    current += 1
  }

  return
}

export const ONE_SEC_IN_MS = 1000

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly responseText: string, public readonly url: string) {
    super(`HttpError: status code ${status}`)
  }
}

export function* take(iterable: Iterable<any>, length: number) {
  if (length === 0) {
    return
  }
  for (const item of iterable) {
    yield item
    length--

    if (length === 0) {
      return
    }
  }
}
