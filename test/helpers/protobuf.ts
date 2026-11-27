export function message(...fields: Buffer[]) {
  return Buffer.concat(fields)
}

export function stringField(fieldNumber: number, value: string) {
  return bytesField(fieldNumber, Buffer.from(value))
}

export function bytesField(fieldNumber: number, value: Buffer) {
  return Buffer.concat([tag(fieldNumber, 2), varint(value.length), value])
}

export function varintField(fieldNumber: number, value: number | bigint) {
  return Buffer.concat([tag(fieldNumber, 0), varint(value)])
}

function tag(fieldNumber: number, wireType: number) {
  return varint(fieldNumber * 8 + wireType)
}

function varint(value: number | bigint) {
  const bytes: number[] = []
  let remaining = BigInt(value)
  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n))
    remaining >>= 7n
  }
  bytes.push(Number(remaining))
  return Buffer.from(bytes)
}
