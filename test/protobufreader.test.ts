import { test } from 'node:test'
import { assert } from './assertions.ts'
import { ProtobufReader } from '../dist/realtimefeeds/protobufreader.js'

test('ProtobufReader reads consecutive fields and tracks the end of the message', () => {
  const reader = new ProtobufReader(Buffer.from('0a 03 61 62 63 10 96 01'.replaceAll(' ', ''), 'hex'))
  assert.strictEqual(reader.done, false)
  assert.deepStrictEqual(reader.readTag(), { fieldNumber: 1, wireType: 2 })
  assert.strictEqual(reader.readString(2), 'abc')
  assert.strictEqual(reader.done, false)
  assert.deepStrictEqual(reader.readTag(), { fieldNumber: 2, wireType: 0 })
  assert.strictEqual(reader.readInt32(0), 150)
  assert.strictEqual(reader.done, true)
  assert.throws(() => reader.readTag(), /Unexpected end of protobuf message/)
})

for (const input of [
  Buffer.from([0x06, 0xc5, 0xbc, 0xc3, 0xb3, 0xc5, 0x82]),
  Uint8Array.from([0x06, 0xc5, 0xbc, 0xc3, 0xb3, 0xc5, 0x82])
]) {
  test(`ProtobufReader decodes UTF-8 from ${input.constructor.name}`, () => {
    const reader = new ProtobufReader(input)
    assert.strictEqual(reader.readString(2), 'żół')
    assert.strictEqual(reader.done, true)
  })
}

test('ProtobufReader reads bounded nested messages and continues at the next outer field', () => {
  const reader = new ProtobufReader(Uint8Array.from([2, 0x08, 1, 0x10, 2]))
  const bytes = reader.readBytes(2)
  assert.deepStrictEqual([...bytes], [0x08, 1])
  const nested = new ProtobufReader(bytes)
  assert.deepStrictEqual(nested.readTag(), { fieldNumber: 1, wireType: 0 })
  assert.strictEqual(nested.readInt32(0), 1)
  assert.strictEqual(nested.done, true)
  assert.deepStrictEqual(reader.readTag(), { fieldNumber: 2, wireType: 0 })
  assert.strictEqual(reader.readInt32(0), 2)
  assert.strictEqual(reader.done, true)
})

test('ProtobufReader reads empty strings, byte fields and messages', () => {
  const reader = new ProtobufReader(Uint8Array.from([0, 0]))
  assert.strictEqual(reader.readString(2), '')
  assert.deepStrictEqual([...reader.readBytes(2)], [])
  assert.strictEqual(reader.done, true)
  assert.strictEqual(new ProtobufReader(new Uint8Array()).done, true)
})

for (const [encoded, expected] of [
  ['00', '0'],
  ['9601', '150'],
  ['8098c59fe231', '1710000000000'],
  ['ffffffffffff7f', '562949953421311'],
  ['8080808080808001', '562949953421312'],
  ['ffffffffffffffff7f', '9223372036854775807'],
  ['ffffffffffffffffff01', '-1'],
  ['80808080808080808001', '-9223372036854775808']
]) {
  test(`ProtobufReader preserves int64 ${expected} as a decimal string`, () => {
    const reader = new ProtobufReader(Buffer.from(encoded, 'hex'))
    assert.strictEqual(reader.readInt64String(0), expected)
    assert.strictEqual(reader.done, true)
  })
}

for (const [encoded, expected] of [
  ['00', 0],
  ['9601', 150],
  ['ffffffff07', 2147483647],
  ['80808080f8ffffffff01', -2147483648],
  ['ffffffffffffffffff01', -1]
] as const) {
  test(`ProtobufReader reads signed int32 ${expected}`, () => {
    const reader = new ProtobufReader(Buffer.from(encoded, 'hex'))
    assert.strictEqual(reader.readInt32(0), expected)
    assert.strictEqual(reader.done, true)
  })
}

test('ProtobufReader skips unknown fields of all supported wire types and preserves following fields', () => {
  const reader = new ProtobufReader(
    Uint8Array.from([
      0xa0,
      0x06,
      0xac,
      0x02, // Field 100: varint.
      0xa9,
      0x06,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // Field 101: fixed64.
      0xb2,
      0x06,
      3,
      0x61,
      0x62,
      0x63, // Field 102: bytes.
      0xbd,
      0x06,
      0,
      0,
      0,
      0, // Field 103: fixed32.
      0x08,
      42 // Following known field.
    ])
  )
  for (const [fieldNumber, wireType] of [
    [100, 0],
    [101, 1],
    [102, 2],
    [103, 5]
  ]) {
    assert.deepStrictEqual(reader.readTag(), { fieldNumber, wireType })
    reader.skipField(wireType)
  }
  assert.deepStrictEqual(reader.readTag(), { fieldNumber: 1, wireType: 0 })
  assert.strictEqual(reader.readInt32(0), 42)
  assert.strictEqual(reader.done, true)
})

for (const encoded of ['00', '07', '8080808010', '8080808080808001']) {
  test(`ProtobufReader rejects invalid tag ${encoded}`, () => {
    const reader = new ProtobufReader(Buffer.from(encoded, 'hex'))
    assert.throws(() => reader.readTag(), /Invalid protobuf (tag|field number)/)
  })
}

for (const [name, read] of [
  ['string', (reader: ProtobufReader) => reader.readString(2)],
  ['bytes', (reader: ProtobufReader) => reader.readBytes(2)],
  ['skipped bytes', (reader: ProtobufReader) => reader.skipField(2)]
] as const) {
  test(`ProtobufReader rejects a truncated ${name} field`, () => {
    assert.throws(() => read(new ProtobufReader(Uint8Array.from([2, 0x61]))), /Invalid protobuf message length/)
  })
  test(`ProtobufReader rejects an unsafe ${name} length`, () => {
    const reader = new ProtobufReader(Buffer.from('8080808080808010', 'hex'))
    assert.throws(() => read(reader), /Invalid protobuf message length/)
  })
}

for (const [name, read] of [
  ['int32', (reader: ProtobufReader) => reader.readInt32(0)],
  ['int64', (reader: ProtobufReader) => reader.readInt64String(0)],
  ['skipped varint', (reader: ProtobufReader) => reader.skipField(0)]
] as const) {
  test(`ProtobufReader rejects a truncated ${name}`, () => {
    assert.throws(() => read(new ProtobufReader(Uint8Array.from([0x80]))), /Unexpected end of protobuf message/)
  })
  test(`ProtobufReader rejects an overlong ${name}`, () => {
    assert.throws(() => read(new ProtobufReader(new Uint8Array(10).fill(0x80))), /Invalid protobuf varint/)
  })
}

for (const [wireType, length] of [
  [1, 7],
  [5, 3]
]) {
  test(`ProtobufReader rejects a truncated skipped wire type ${wireType}`, () => {
    assert.throws(() => new ProtobufReader(new Uint8Array(length)).skipField(wireType), /Invalid protobuf message length/)
  })
}

for (const wireType of [3, 4, 6, 7]) {
  test(`ProtobufReader rejects unsupported wire type ${wireType}`, () => {
    assert.throws(() => new ProtobufReader(new Uint8Array()).skipField(wireType), /Unsupported protobuf wire type/)
  })
}

test('ProtobufReader rejects mismatched wire types for typed reads', () => {
  const reader = new ProtobufReader(Uint8Array.from([0]))
  assert.throws(() => reader.readString(0), /Invalid protobuf wire type 0, expected 2/)
  assert.throws(() => reader.readBytes(1), /Invalid protobuf wire type 1, expected 2/)
  assert.throws(() => reader.readInt32(2), /Invalid protobuf wire type 2, expected 0/)
  assert.throws(() => reader.readInt64String(5), /Invalid protobuf wire type 5, expected 0/)
})
