import { Transform } from 'stream'
import type { TransformCallback } from 'stream'

const NEW_LINE_BYTE = 10

// Inspired by https://github.com/maxogden/binary-split/blob/master/index.js.
// Batching lines lets replay cross the object-mode async iterator boundary once per decompressed chunk.
export class BinarySplitBatchStream extends Transform {
  private _buffered?: Buffer

  constructor() {
    super({
      readableObjectMode: true,
      // A batch can hold a full decompression chunk, so keep read-ahead deliberately small.
      readableHighWaterMark: 2
    })
  }

  _transform(chunk: Buffer, _: string, callback: TransformCallback) {
    const lines: Buffer[] = []
    let lineStart = 0

    if (this._buffered !== undefined) {
      const firstNewLineIndex = chunk.indexOf(NEW_LINE_BYTE)

      if (firstNewLineIndex === -1) {
        this._buffered = Buffer.concat([this._buffered, chunk])
        callback()
        return
      }

      lines.push(Buffer.concat([this._buffered, chunk.subarray(0, firstNewLineIndex)]))
      this._buffered = undefined
      lineStart = firstNewLineIndex + 1
    }

    let newLineIndex = chunk.indexOf(NEW_LINE_BYTE, lineStart)
    while (newLineIndex !== -1) {
      lines.push(chunk.subarray(lineStart, newLineIndex))
      lineStart = newLineIndex + 1
      newLineIndex = chunk.indexOf(NEW_LINE_BYTE, lineStart)
    }

    this._buffered = lineStart < chunk.length ? chunk.subarray(lineStart) : undefined
    if (lines.length > 0) {
      this.push(lines)
    }
    callback()
  }
}
