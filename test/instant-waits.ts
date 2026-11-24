import { mock, type TestContext } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { isMainThread } from 'node:worker_threads'

// Preloaded into every test process: reconnect, retry and back-off delays of the package pass at the next timer tick,
// so tests run in seconds. Tests check the delays the package asked for in requestedWaits instead of measuring them.
export const requestedWaits: number[] = []

let realWaits = false

export function setRealWaits(enabled: boolean) {
  realWaits = enabled
}

// Tests that talk to real exchanges or the Tardis API, or verify aborting an active wait, keep real delays.
export function useRealWaits(context: TestContext) {
  setRealWaits(true)
  context.after(() => setRealWaits(false))
}

async function abortableWait(delayMS: number, signal: AbortSignal) {
  requestedWaits.push(delayMS)
  if (signal.aborted) {
    return
  }
  try {
    await sleep(realWaits ? delayMS : 0, undefined, { signal })
  } catch (error) {
    if (signal.aborted === false) {
      throw error
    }
  }
}

async function wait(delayMS: number) {
  requestedWaits.push(delayMS)
  await sleep(realWaits ? delayMS : 0)
}

// Replay worker threads fetch from the real Tardis API, so their waits stay real.
if (isMainThread) {
  mock.module('../dist/wait.js', { exports: { abortableWait, wait } })
}
