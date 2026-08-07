import { describe, test } from 'node:test'
import { Readable } from 'stream'
import { assert } from './assertions.ts'
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
  test('limits buffered decompression batches', () => {
    assert.strictEqual(new BinarySplitBatchStream().readableHighWaterMark, 2)
  })

  test('preserves complete records, disconnect markers, and chunk boundaries', async () => {
    assert.deepStrictEqual(await collectBatches([Buffer.from('alpha\nbeta\ngamma\n')]), [['alpha', 'beta', 'gamma']])
    assert.deepStrictEqual(await collectLines([Buffer.from('alpha\n\nbeta\n')]), ['alpha', '', 'beta'])
    assert.deepStrictEqual(await collectLines([Buffer.from('alp'), Buffer.from('ha\nbe'), Buffer.from('ta\ngam'), Buffer.from('ma\n')]), [
      'alpha',
      'beta',
      'gamma'
    ])
    assert.deepStrictEqual(await collectLines([Buffer.from('alpha\n'), Buffer.from('\n'), Buffer.from('beta\n')]), ['alpha', '', 'beta'])
  })

  test('drops final partial line when stream ends without trailing newline', async () => {
    assert.deepStrictEqual(await collectLines([Buffer.from('alpha\nbeta'), Buffer.from('\ngamma')]), ['alpha', 'beta'])
  })
})
