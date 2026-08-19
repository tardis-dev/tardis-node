import dbg from 'debug'

// Keep the public declarations independent from @types/debug. Tardis only relies
// on this callable part of the logger, while preserving the properties available
// to subclasses through RealTimeFeedBase.debug.
export interface DebugLogger {
  (formatter: any, ...args: any[]): void
  color: string
  diff: number
  enabled: boolean
  log: (...args: any[]) => any
  namespace: string
  destroy: () => boolean
  extend: (namespace: string, delimiter?: string) => DebugLogger
}

export const createDebug = dbg as (namespace: string) => DebugLogger
export const debug = createDebug('tardis-dev')
