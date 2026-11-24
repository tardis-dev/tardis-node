import { after, before, describe } from 'node:test'
import { setRealWaits } from './instant-waits.ts'

export const shouldRunLiveTests = process.env.RUN_LIVE_TESTS === '1'

// Live tests talk to real exchanges and the Tardis API, so their back-off and pacing stay real.
export const describeLive = shouldRunLiveTests
  ? (name: string, fn: () => void) =>
      describe(name, () => {
        before(() => setRealWaits(true))
        after(() => setRealWaits(false))
        fn()
      })
  : describe.skip
