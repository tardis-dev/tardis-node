import { once } from 'node:events'
import { open, type FileHandle } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { createZstdDecompress } from 'node:zlib'

const ZSTD_FRAME_MAGIC = 0xfd2fb528
const DICTIONARY_ID_SIZES = [0, 1, 2, 4]

export function createZstdDecompressionStream(path: string, chunkSize: number) {
  return Readable.from(decompressZstdFrames(path, chunkSize), { objectMode: false })
}

async function* decompressZstdFrames(path: string, chunkSize: number) {
  const file = await open(path, 'r')
  try {
    const fileSize = (await file.stat()).size
    const frames = await findZstdFrames(file, path, fileSize)

    for (const frame of frames) {
      const source = Readable.from(readFileRange(file, frame.offset, frame.length, chunkSize), { objectMode: false })
      const decompressor = createZstdDecompress({ chunkSize })
      source.on('error', (error) => decompressor.destroy(error))
      source.pipe(decompressor)

      try {
        for await (const chunk of decompressor) {
          yield chunk
        }

        if (decompressor.bytesWritten !== frame.length) {
          throw new Error(
            `Zstd decoder consumed ${decompressor.bytesWritten} of ${frame.length} bytes at offset ${frame.offset} in ${path}`
          )
        }
      } finally {
        source.unpipe(decompressor)
        source.destroy()
        decompressor.destroy()
        if (!source.closed) {
          await once(source, 'close')
        }
      }
    }
  } finally {
    await file.close()
  }
}

async function findZstdFrames(file: FileHandle, path: string, fileSize: number) {
  if (fileSize === 0) {
    throw new Error(`Empty zstd file: ${path}`)
  }

  const bytes = Buffer.allocUnsafe(4)
  const frames: { offset: number; length: number }[] = []
  let offset = 0

  while (offset < fileSize) {
    const frameStart = offset
    await readExactly(file, bytes, 4, offset, fileSize, path)
    if (bytes.readUInt32LE(0) !== ZSTD_FRAME_MAGIC) {
      throw new Error(`Invalid zstd frame magic at offset ${offset} in ${path}`)
    }
    offset += 4

    await readExactly(file, bytes, 1, offset, fileSize, path)
    const descriptor = bytes[0]
    if ((descriptor & 0x08) !== 0) {
      throw new Error(`Unsupported reserved zstd frame descriptor bit at offset ${offset} in ${path}`)
    }
    offset++

    const singleSegment = (descriptor & 0x20) !== 0
    const contentChecksum = (descriptor & 0x04) !== 0
    const dictionaryIdSize = DICTIONARY_ID_SIZES[descriptor & 0x03]
    const contentSizeFlag = descriptor >>> 6
    const contentSizeSize = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const windowDescriptorSize = singleSegment ? 0 : 1
    offset += windowDescriptorSize + dictionaryIdSize + contentSizeSize
    ensureAvailable(offset, 0, fileSize, path)

    let lastBlock = false
    while (!lastBlock) {
      await readExactly(file, bytes, 3, offset, fileSize, path)
      const blockHeader = bytes.readUIntLE(0, 3)
      offset += 3
      lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      if (blockType === 3) {
        throw new Error(`Invalid reserved zstd block type at offset ${offset - 3} in ${path}`)
      }

      const blockSize = blockHeader >>> 3
      // RLE blocks store one repeated byte; other block types store blockSize bytes.
      offset += blockType === 1 ? 1 : blockSize
      ensureAvailable(offset, 0, fileSize, path)
    }

    if (contentChecksum) {
      offset += 4
      ensureAvailable(offset, 0, fileSize, path)
    }
    frames.push({ offset: frameStart, length: offset - frameStart })
  }

  return frames
}

async function* readFileRange(file: FileHandle, position: number, length: number, chunkSize: number) {
  let bytesRemaining = length
  while (bytesRemaining > 0) {
    const buffer = Buffer.allocUnsafe(Math.min(bytesRemaining, chunkSize))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, position)
    if (bytesRead === 0) {
      throw new Error(`Expected ${length} compressed bytes, read ${length - bytesRemaining}`)
    }
    yield bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead)
    position += bytesRead
    bytesRemaining -= bytesRead
  }
}

async function readExactly(file: FileHandle, buffer: Buffer, length: number, position: number, fileSize: number, path: string) {
  ensureAvailable(position, length, fileSize, path)
  let bytesRead = 0
  while (bytesRead < length) {
    const result = await file.read(buffer, bytesRead, length - bytesRead, position + bytesRead)
    if (result.bytesRead === 0) {
      throw new Error(`Truncated zstd frame at offset ${position + bytesRead} in ${path}`)
    }
    bytesRead += result.bytesRead
  }
}

function ensureAvailable(position: number, length: number, fileSize: number, path: string) {
  if (position < 0 || length < 0 || position > fileSize - length) {
    throw new Error(`Truncated zstd frame at offset ${position} in ${path}`)
  }
}
