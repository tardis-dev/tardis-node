import { test } from 'node:test'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'
import { normalizeBookChanges, SequenceGapError, stream, streamNormalized } from '../dist/index.js'

for (const exchange of ['okex', 'okex-futures', 'okex-swap', 'okex-options'] as const) {
  for (const validateSequence of [undefined, true, false]) {
    test(`${exchange} depth continuity: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
      const depth = (action: string, pairs: [number, number][], instId = 'BTC-USDT') => ({
        arg: { channel: 'books', instId },
        action,
        data: pairs.map(([seqId, prevSeqId]) => ({ seqId, prevSeqId, asks: [], bids: [], ts: '1794300000000' }))
      })
      const native = [
        { event: 'subscribe', arg: { channel: 'books', instId: 'BTC-USDT' } },
        depth('update', [[100, 99]]),
        depth('update', [
          [105, 100],
          [110, 105]
        ]),
        depth('update', [[110, 105]]),
        depth('update', [[110, 110]]),
        depth('update', [
          [3, 110],
          [5, 3]
        ]),
        depth('snapshot', [
          [500, -1],
          [505, -1]
        ]),
        depth('update', [[510, 505]]),
        depth('snapshot', [[0, -1]]),
        depth('update', [[1, 0]]),
        depth('snapshot', [[800, -1]], 'ETH-USDT'),
        depth('update', [[805, 800]], 'ETH-USDT'),
        { ...depth('update', [[9999, 9998]]), arg: { channel: 'books5', instId: 'BTC-USDT' } },
        { ...depth('update', [[9999, 9998]]), arg: { channel: 'books-l2-tbt', instId: 'BTC-USDT' } },
        { ...depth('update', [[9999, 9998]]), arg: { channel: 'books50-l2-tbt', instId: 'BTC-USDT' } },
        { ...depth('update', [[9999, 9998]]), arg: { channel: 'bbo-tbt', instId: 'BTC-USDT' } },
        depth('update', [[9999, 9998]], ''),
        depth('update', [[2, 1]])
      ]
      const gap = depth('update', [
          [5, 4],
          [6, 5]
        ]),
        errors: Error[] = []
      const { server, cleanup } = await createTestWebSocketServer(exchange)
      server.on('connection', (socket) =>
        socket.once('message', (bytes) => {
          assert.deepStrictEqual(JSON.parse(bytes.toString()), {
            op: 'subscribe',
            args: [
              { channel: 'books', instId: 'BTC-USDT' },
              { channel: 'books', instId: 'ETH-USDT' }
            ]
          })
          for (const message of [...native, gap]) socket.send(JSON.stringify(message))
        })
      )
      const messages = stream({
        exchange,
        filters: [{ channel: 'books', symbols: ['BTC-USDT', 'ETH-USDT'] }],
        timeoutIntervalMS: 0,
        validateSequence,
        withDisconnects: true,
        onError: (error) => errors.push(error)
      })
      try {
        for (const message of native) assert.deepStrictEqual((await messages.next()).value?.message, message)
        const next = (await messages.next()).value
        if (validateSequence === false) {
          assert.deepStrictEqual(next?.message, gap)
          assert.deepStrictEqual(errors, [])
        } else {
          assert.strictEqual(next, undefined)
          assert.strictEqual(errors.length, 1)
          assert.ok(errors[0] instanceof SequenceGapError)
          assert.strictEqual(errors[0].exchange, exchange)
          assert.strictEqual(errors[0].key, 'BTC-USDT')
          assert.strictEqual(errors[0].expectedPreviousSequence, 2)
          assert.strictEqual(errors[0].previousSequence, 4)
          assert.strictEqual(errors[0].sequence, 6)
        }
      } finally {
        await messages.return?.()
        await cleanup()
      }
    })
  }

  for (const validateSequence of [undefined, false]) {
    test(`${exchange} rejects a gap inside a depth batch: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
      const snapshot = { arg: { channel: 'books', instId: 'BTC-USDT' }, action: 'snapshot', data: [{ seqId: 100, prevSeqId: -1 }] }
      // The first prevSeqId and final seqId hide a broken middle link unless every adjacent entry is checked.
      const gap = {
        arg: snapshot.arg,
        action: 'update',
        data: [
          { seqId: 105, prevSeqId: 100 },
          { seqId: 110, prevSeqId: 109 },
          { seqId: 115, prevSeqId: 110 }
        ]
      }
      const errors: Error[] = [],
        { server, cleanup } = await createTestWebSocketServer(exchange)
      server.on('connection', (socket) =>
        socket.once('message', () => {
          for (const message of [snapshot, gap]) socket.send(JSON.stringify(message))
        })
      )
      const messages = stream({
        exchange,
        filters: [{ channel: 'books', symbols: ['BTC-USDT'] }],
        timeoutIntervalMS: 0,
        validateSequence,
        withDisconnects: true,
        onError: (error) => errors.push(error)
      })
      try {
        assert.deepStrictEqual((await messages.next()).value?.message, snapshot)
        const next = (await messages.next()).value
        if (validateSequence === false) {
          assert.deepStrictEqual(next?.message, gap)
          assert.deepStrictEqual(errors, [])
        } else {
          assert.strictEqual(next, undefined)
          assert.strictEqual(errors.length, 1)
          assert.ok(errors[0] instanceof SequenceGapError)
          assert.strictEqual(errors[0].exchange, exchange)
          assert.strictEqual(errors[0].key, 'BTC-USDT')
          assert.strictEqual(errors[0].expectedPreviousSequence, 105)
          assert.strictEqual(errors[0].previousSequence, 109)
          assert.strictEqual(errors[0].sequence, 110)
        }
      } finally {
        await messages.return?.()
        await cleanup()
      }
    })
  }

  for (const normalized of [false, true]) {
    for (const withDisconnects of [false, true]) {
      test(`${exchange} depth recovery: normalized=${normalized}, disconnects=${withDisconnects}`, { timeout: 10000 }, async () => {
        const depth = (action: string, seqId: number, prevSeqId: number) => ({
          arg: { channel: 'books', instId: 'BTC-USDT' },
          action,
          data: [{ seqId, prevSeqId, ts: '1794300000000', bids: [['100', String(seqId), '0', '1']], asks: [] }]
        })
        const errors: Error[] = [],
          connections = new Map<string, number>(),
          { server, cleanup } = await createTestWebSocketServer(exchange)
        let sendGap: (() => void) | undefined
        server.on('connection', (socket) =>
          socket.once('message', (bytes) => {
            const request = JSON.parse(bytes.toString()),
              channel = request.args[0].channel
            const attempt = (connections.get(channel) ?? 0) + 1
            connections.set(channel, attempt)
            if (channel === 'books') {
              for (const message of attempt === 1
                ? [depth('snapshot', 100, -1), depth('update', 105, 100)]
                : [depth('snapshot', 0, -1), depth('update', 2, 0)])
                socket.send(JSON.stringify(message))
              sendGap = () => socket.send(JSON.stringify(depth('update', 110, 109)))
            } else socket.send(JSON.stringify({ event: 'subscribe', arg: { channel, instId: 'BTC-USDT' } }))
          })
        )
        const options = { exchange, timeoutIntervalMS: 0, onError: (error: Error) => errors.push(error) }
        // Raw mode also exercises the separate business child; normalized books retain their normal filters.
        const messages = normalized
          ? streamNormalized({ ...options, symbols: ['BTC-USDT'], withDisconnectMessages: withDisconnects }, normalizeBookChanges)
          : stream({
              ...options,
              filters: [
                { channel: 'books', symbols: ['BTC-USDT'] },
                { channel: 'trades-all', symbols: ['BTC-USDT'] }
              ],
              withDisconnects
            })
        const output: any[] = []
        let boundaries = 0,
          businessAcks = 0
        try {
          for await (const message of messages) {
            if (message === undefined || ('type' in message && message.type === 'disconnect')) {
              boundaries++
              continue
            }
            if ('message' in message && message.message.event === 'subscribe') {
              businessAcks++
              if (output.length === 2 && businessAcks === 1) sendGap!()
              if (output.length === 4 && businessAcks === 2) break
              continue
            }
            output.push(message)
            if (output.length === 2 && (normalized || businessAcks === 1)) sendGap!()
            if (output.length === 4 && (normalized || businessAcks === 2)) break
          }
          if (normalized) {
            assert.deepStrictEqual(
              output.map((m) => m.isSnapshot),
              [true, false, true, false]
            )
            assert.deepStrictEqual(
              output.map((m) => m.bids),
              [100, 105, 0, 2].map((amount) => [{ price: 100, amount }])
            )
          } else {
            assert.deepStrictEqual(
              output.map((m) => m.message),
              [depth('snapshot', 100, -1), depth('update', 105, 100), depth('snapshot', 0, -1), depth('update', 2, 0)]
            )
            assert.strictEqual(connections.get('trades-all'), 2)
          }
          assert.strictEqual(connections.get('books'), 2)
          assert.strictEqual(boundaries, withDisconnects ? 1 : 0)
          assert.strictEqual(errors.length, 1)
          assert.ok(errors[0] instanceof SequenceGapError)
        } finally {
          await messages.return?.()
          await cleanup()
        }
      })
    }
  }

  test(`${exchange} normalized opt-out accepts external and internal gaps`, { timeout: 10000 }, async () => {
    const errors: Error[] = [],
      { server, cleanup } = await createTestWebSocketServer(exchange)
    server.on('connection', (socket) =>
      socket.once('message', () => {
        const data = (seqId: number, prevSeqId: number) => ({
          seqId,
          prevSeqId,
          ts: '1794300000000',
          bids: [['100', String(seqId), '0', '1']],
          asks: []
        })
        socket.send(JSON.stringify({ arg: { channel: 'books', instId: 'BTC-USDT' }, action: 'snapshot', data: [data(100, -1)] }))
        socket.send(
          JSON.stringify({ arg: { channel: 'books', instId: 'BTC-USDT' }, action: 'update', data: [data(110, 109), data(120, 119)] })
        )
      })
    )
    const messages = streamNormalized(
      { exchange, symbols: ['BTC-USDT'], timeoutIntervalMS: 0, validateSequence: false, onError: (error) => errors.push(error) },
      normalizeBookChanges
    )
    try {
      for (const amount of [100, 110, 120]) assert.deepStrictEqual((await messages.next()).value.bids, [{ price: 100, amount }])
      assert.deepStrictEqual(errors, [])
    } finally {
      await messages.return?.()
      await cleanup()
    }
  })
}
