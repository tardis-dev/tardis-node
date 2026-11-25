const textDecoder = new TextDecoder()

export class ProtobufReader {
  private offset = 0

  constructor(private readonly data: Uint8Array) {}

  get done() {
    return this.offset === this.data.length
  }

  readTag() {
    const tag = this.readVarint()
    if (typeof tag === 'bigint' || tag > 0xffffffff) {
      throw new Error('Invalid protobuf tag')
    }

    const fieldNumber = tag >>> 3
    const wireType = tag & 7

    if (fieldNumber === 0) {
      throw new Error('Invalid protobuf field number 0')
    }

    return { fieldNumber, wireType }
  }

  readString(wireType: number) {
    this.expectWireType(wireType, 2)
    const length = this.readLength()
    const start = this.offset
    const end = start + length

    if (end > this.data.length) {
      throw new Error('Invalid protobuf message length')
    }

    this.offset = end
    return Buffer.isBuffer(this.data) ? this.data.toString('utf8', start, end) : textDecoder.decode(this.data.subarray(start, end))
  }

  readBytes(wireType: number) {
    this.expectWireType(wireType, 2)
    const length = this.readLength()
    const end = this.offset + length

    if (end > this.data.length) {
      throw new Error('Invalid protobuf message length')
    }

    const value = this.data.subarray(this.offset, end)
    this.offset = end
    return value
  }

  readInt32(wireType: number) {
    this.expectWireType(wireType, 0)
    const value = this.readVarint()
    return typeof value === 'number' ? value | 0 : Number(BigInt.asIntN(32, value))
  }

  readInt64String(wireType: number) {
    this.expectWireType(wireType, 0)
    const value = this.readVarint()
    return typeof value === 'number' ? value.toString() : BigInt.asIntN(64, value).toString()
  }

  skipField(wireType: number): void {
    switch (wireType) {
      case 0:
        this.skipVarint()
        return
      case 1:
        this.skipBytes(8)
        return
      case 2:
        this.skipBytes(this.readLength())
        return
      case 5:
        this.skipBytes(4)
        return
      default:
        throw new Error(`Unsupported protobuf wire type ${wireType}`)
    }
  }

  private readVarint() {
    let value = 0
    let multiplier = 1

    // Seven base-128 digits use at most 49 bits, so they remain exact and fast as a number.
    for (let index = 0; index < 7; index++) {
      const byte = this.readByte()
      value += (byte & 0x7f) * multiplier

      if ((byte & 0x80) === 0) {
        return value
      }
      multiplier *= 0x80
    }

    // Larger int64 values need BigInt to preserve every bit before converting them to strings.
    let bigValue = BigInt(value)
    for (let index = 7; index < 10; index++) {
      const byte = this.readByte()
      bigValue |= BigInt(byte & 0x7f) << BigInt(index * 7)

      if ((byte & 0x80) === 0) {
        return bigValue
      }
    }

    throw new Error('Invalid protobuf varint')
  }

  private readLength() {
    const length = this.readVarint()
    if (typeof length === 'bigint' || Number.isSafeInteger(length) === false) {
      throw new Error('Invalid protobuf message length')
    }
    return length
  }

  private skipVarint() {
    for (let index = 0; index < 10; index++) {
      if ((this.readByte() & 0x80) === 0) {
        return
      }
    }
    throw new Error('Invalid protobuf varint')
  }

  private readByte() {
    if (this.offset >= this.data.length) {
      throw new Error('Unexpected end of protobuf message')
    }
    return this.data[this.offset++]!
  }

  private skipBytes(length: number) {
    const end = this.offset + length
    if (Number.isSafeInteger(length) === false || end > this.data.length) {
      throw new Error('Invalid protobuf message length')
    }
    this.offset = end
  }

  private expectWireType(actual: number, expected: number) {
    if (actual !== expected) {
      throw new Error(`Invalid protobuf wire type ${actual}, expected ${expected}`)
    }
  }
}
