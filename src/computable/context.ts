export type ComputableContext = Map<symbol, unknown>

const contextualFactories = new WeakMap<Function, (context: ComputableContext) => unknown>()

export function registerContextualFactory<T>(factory: () => T, contextualFactory: (context: ComputableContext) => T) {
  contextualFactories.set(factory, contextualFactory)
}

export function createWithContext<T>(factory: () => T, context: ComputableContext): T {
  const contextualFactory = contextualFactories.get(factory)
  return contextualFactory === undefined ? factory() : (contextualFactory(context) as T)
}
