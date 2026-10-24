import { createReadStream } from 'node:fs'
import { createZstdDecompress } from 'node:zlib'

export function createZstdDecompressionStream(path: string, chunkSize: number) {
  // Node supports rejectGarbageAfterEnd for Zstd; @types/node does not declare it yet.
  const decoderOptions = { chunkSize, rejectGarbageAfterEnd: true }
  return createReadStream(path, { highWaterMark: chunkSize }).compose(createZstdDecompress(decoderOptions))
}
