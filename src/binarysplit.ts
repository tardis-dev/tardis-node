import { Transform } from 'stream'
import type { TransformCallback } from 'stream'

// Inspired by https://github.com/maxogden/binary-split/blob/master/index.js
export class BinarySplitStream extends Transform {
  private readonly _NEW_LINE_BYTE: number
  private _buffered?: Buffer

  constructor() {
    super({
      readableObjectMode: true
    })

    this._NEW_LINE_BYTE = 10
    this._buffered = undefined
  }

  _transform(chunk: Buffer, _: string, callback: TransformCallback) {
    let chunkStart = 0

    if (this._buffered !== undefined) {
      const firstNewLineIndex = chunk.indexOf(this._NEW_LINE_BYTE)

      if (firstNewLineIndex === -1) {
        this._buffered = Buffer.concat([this._buffered, chunk])
        callback()
        return
      }

      this.push(Buffer.concat([this._buffered, chunk.subarray(0, firstNewLineIndex)]))
      this._buffered = undefined
      chunkStart = firstNewLineIndex + 1
    }

    let offset = chunkStart
    let lineStart = chunkStart

    while (true) {
      const newLineIndex = chunk.indexOf(this._NEW_LINE_BYTE, offset)
      if (newLineIndex === -1) {
        break
      }

      this.push(chunk.subarray(lineStart, newLineIndex))
      offset = newLineIndex + 1
      lineStart = offset
    }

    this._buffered = lineStart < chunk.length ? chunk.subarray(lineStart) : undefined
    callback()
  }
}
