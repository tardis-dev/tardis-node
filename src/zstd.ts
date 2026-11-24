import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream'
import { createZstdDecompress } from 'node:zlib'

export function createZstdDecompressionStream(path: string, chunkSize: number) {
  // Node supports rejectGarbageAfterEnd for Zstd; @types/node does not declare it yet.
  const decoderOptions = { chunkSize, rejectGarbageAfterEnd: true }
  // Readers get every error from the decoder. With stream.compose, a truncated frame sometimes escaped as an uncaught error
  // and left the reader waiting forever.
  return pipeline(createReadStream(path, { highWaterMark: chunkSize }), createZstdDecompress(decoderOptions), () => {})
}
