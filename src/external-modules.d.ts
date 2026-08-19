// debug ships JavaScript only; src/debug.ts defines the smaller type surface Tardis uses.
declare module 'debug' {
  const createDebug: unknown
  export default createDebug
}
