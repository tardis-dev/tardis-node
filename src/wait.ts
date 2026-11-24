import { setTimeout as sleep } from 'node:timers/promises'

export function wait(delayMS: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMS)
  })
}

export async function abortableWait(delayMS: number, signal: AbortSignal) {
  try {
    await sleep(delayMS, undefined, { signal })
  } catch (error) {
    if (signal.aborted === false) {
      throw error
    }
  }
}
