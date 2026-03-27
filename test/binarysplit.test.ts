import { Readable } from 'stream'
import { BinarySplitStream } from '../dist/binarysplit.js'

async function collectLines(chunks: Buffer[]) {
  const lines: string[] = []

  for await (const line of Readable.from(chunks).pipe(new BinarySplitStream()) as AsyncIterable<Buffer>) {
    lines.push(line.toString('utf8'))
  }

  return lines
}

describe('BinarySplitStream', () => {
  test('splits multiple lines from a single chunk', async () => {
    await expect(collectLines([Buffer.from('alpha\nbeta\ngamma\n')])).resolves.toEqual(['alpha', 'beta', 'gamma'])
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
