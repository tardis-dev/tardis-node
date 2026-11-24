import { createZstdDecompress } from 'node:zlib'

export function createZstdDecompressor(chunkSize: number) {
  // Node supports rejectGarbageAfterEnd for Zstd; @types/node does not declare it yet.
  const decoderOptions = { chunkSize, rejectGarbageAfterEnd: true }
  return createZstdDecompress(decoderOptions)
}
