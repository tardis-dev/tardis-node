import { Transform, TransformCallback } from 'stream'
// inspired by https://github.com/maxogden/binary-split/blob/master/index.js
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
    let offset = 0
    let lastMatch = 0
    let bufferToSplit = chunk
    // if we already had something remaining in the buffer let's concat it with current chunk
    if (this._buffered) {
      bufferToSplit = Buffer.concat([this._buffered, chunk])

      offset = this._buffered.length
      this._buffered = undefined
    }

    while (true) {
      let newLineIndex = bufferToSplit.indexOf(this._NEW_LINE_BYTE, offset)
      if (newLineIndex !== -1) {
        this.push(bufferToSplit.slice(lastMatch, newLineIndex))
        offset = newLineIndex + 1
        lastMatch = offset
      } else {
        this._buffered = bufferToSplit.slice(lastMatch)
        break
      }
    }

    callback()
  }
}
