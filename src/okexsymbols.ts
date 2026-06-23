export function getOkexOptionsFamilyOrIndex(symbol: string) {
  const symbolParts = symbol.split('-')
  return `${symbolParts[0]}-${symbolParts[1]}`
}

export function getOkexOptionsUnderlyingIndex(symbol: string) {
  const symbolParts = symbol.split('-')
  const quote = symbolParts[1].split('_')[0]
  return `${symbolParts[0]}-${quote}`
}
