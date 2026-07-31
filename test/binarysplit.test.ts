import { Readable } from 'stream'
import { BinarySplitBatchStream } from '../dist/binarysplit.js'

async function collectBatches(chunks: Buffer[]) {
  const batches: string[][] = []

  for await (const batch of Readable.from(chunks).pipe(new BinarySplitBatchStream()) as AsyncIterable<Buffer[]>) {
    batches.push(batch.map((line) => line.toString('utf8')))
  }

  return batches
}

async function collectLines(chunks: Buffer[]) {
  return (await collectBatches(chunks)).flat()
}

describe('BinarySplitBatchStream', () => {
  test('sets the readable batch high water mark to two', () => {
    expect(new BinarySplitBatchStream().readableHighWaterMark).toBe(2)
  })

  test('batches lines from a single chunk', async () => {
    await expect(collectBatches([Buffer.from('alpha\nbeta\ngamma\n')])).resolves.toEqual([['alpha', 'beta', 'gamma']])
  })

  test('preserves empty lines', async () => {
    await expect(collectLines([Buffer.from('alpha\n\nbeta\n')])).resolves.toEqual(['alpha', '', 'beta'])
  })

  test('splits lines that cross chunk boundaries', async () => {
    await expect(collectLines([Buffer.from('alp'), Buffer.from('ha\nbe'), Buffer.from('ta\ngam'), Buffer.from('ma\n')])).resolves.toEqual([
      'alpha',
      'beta',
      'gamma'
    ])
  })

  test('handles newline at chunk boundary without losing empty line', async () => {
    await expect(collectLines([Buffer.from('alpha\n'), Buffer.from('\n'), Buffer.from('beta\n')])).resolves.toEqual(['alpha', '', 'beta'])
  })

  test('drops final partial line when stream ends without trailing newline', async () => {
    await expect(collectLines([Buffer.from('alpha\nbeta'), Buffer.from('\ngamma')])).resolves.toEqual(['alpha', 'beta'])
  })
})
