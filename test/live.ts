import { describe, test } from 'node:test'

export const shouldRunLiveTests = process.env.RUN_LIVE_TESTS === '1'

export const describeLive = shouldRunLiveTests ? describe : describe.skip
export const testLive = shouldRunLiveTests ? test : test.skip
