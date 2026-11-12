import { test } from 'node:test'
import { assert } from './assertions.ts'
import { createTestWebSocketServer } from './helpers/websocket.ts'
import { normalizeBookChanges, OrderBook, SequenceGapError, stream, streamNormalized } from '../dist/index.js'

for (const validateSequence of [undefined, true, false]) {
  test(`Deribit depth continuity and startup overlap: validation=${validateSequence ?? 'default'}`, { timeout: 10000 }, async () => {
    const book = (type: string, change_id: number, prev_change_id?: number | null, instrument_name = 'BTC-PERPETUAL') => ({
      jsonrpc: '2.0',
      method: 'subscription',
      params: {
        channel: `book.${instrument_name}.100ms`,
        data: {
          type,
          change_id,
          ...(prev_change_id === undefined ? {} : { prev_change_id }),
          instrument_name,
          timestamp: 1794300000000,
          bids: [],
          asks: []
        }
      }
    })
    const native = [
      { jsonrpc: '2.0', id: 3, result: ['book.BTC-PERPETUAL.100ms'] },
      book('change', 50, 49),
      book('snapshot', 100),
      book('change', 95, 94),
      book('change', 99, 96),
      book('change', 105, 98),
      book('change', 110, 105),
      book('change', 110, 105),
      book('change', 110),
      book('change', 110, null),
      book('snapshot', 500, undefined, 'ETH-PERPETUAL'),
      book('change', 510, 490, 'ETH-PERPETUAL'),
      { ...book('change', 9999, 9998), params: { channel: 'ticker.BTC-PERPETUAL.100ms', data: { change_id: 9999, prev_change_id: 9998 } } },
      book('snapshot', 200),
      book('change', 195, 194),
      book('change', 205, 199),
      book('change', 210, 205),
      book('snapshot', 0),
      book('change', 2, 0),
      book('change', 3, 2)
    ]
    const gap = book('change', 5, 4),
      errors: Error[] = []
    const { server, cleanup } = await createTestWebSocketServer('deribit')
    server.on('connection', (socket) =>
      socket.on('message', (bytes) => {
        const request = JSON.parse(bytes.toString())
        if (request.method.endsWith('/subscribe')) {
          assert.deepStrictEqual(request.params.channels, ['book.BTC-PERPETUAL.100ms', 'book.ETH-PERPETUAL.100ms'])
          for (const message of [...native, gap]) socket.send(JSON.stringify(message))
        }
      })
    )
    const messages = stream({
      exchange: 'deribit',
      filters: [{ channel: 'book', symbols: ['BTC-PERPETUAL', 'ETH-PERPETUAL'] }],
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
        assert.strictEqual(errors[0].exchange, 'deribit')
        assert.strictEqual(errors[0].key, 'BTC-PERPETUAL')
        assert.strictEqual(errors[0].expectedPreviousSequence, 3)
        assert.strictEqual(errors[0].previousSequence, 4)
        assert.strictEqual(errors[0].sequence, 5)
      }
    } finally {
      await messages.return?.()
      await cleanup()
    }
  })
}

for (const phase of [
  'first-change',
  'after-overlap',
  'after-duplicate',
  'after-missing-previous-duplicate',
  'after-null-previous-duplicate'
] as const) {
  test(`Deribit rejects a gap ${phase}`, { timeout: 10000 }, async () => {
    const book = (type: string, change_id: number, prev_change_id?: number | null) => ({
      params: { channel: 'book.BTC-PERPETUAL.raw', data: { type, instrument_name: 'BTC-PERPETUAL', change_id, prev_change_id } }
    })
    const native = [book('snapshot', 100)]
    if (phase === 'after-overlap') native.push(book('change', 105, 98))
    if (phase === 'after-duplicate') native.push(book('change', 100, 90))
    if (phase === 'after-missing-previous-duplicate') native.push(book('change', 100))
    if (phase === 'after-null-previous-duplicate') native.push(book('change', 100, null))
    const gap = phase === 'first-change' ? book('change', 110, 109) : book('change', 99, 98)
    const errors: Error[] = [],
      { server, cleanup } = await createTestWebSocketServer('deribit')
    server.on('connection', (socket) =>
      socket.on('message', (bytes) => {
        if (JSON.parse(bytes.toString()).method.endsWith('/subscribe'))
          for (const message of [...native, gap]) socket.send(JSON.stringify(message))
      })
    )
    const messages = stream({
      exchange: 'deribit',
      filters: [{ channel: 'book', symbols: ['BTC-PERPETUAL'] }],
      timeoutIntervalMS: 0,
      withDisconnects: true,
      onError: (error) => errors.push(error)
    })
    try {
      for (const message of native) assert.deepStrictEqual((await messages.next()).value?.message, JSON.parse(JSON.stringify(message)))
      assert.strictEqual((await messages.next()).value, undefined)
      assert.strictEqual(errors.length, 1)
      assert.ok(errors[0] instanceof SequenceGapError)
      assert.strictEqual(errors[0].expectedPreviousSequence, phase === 'after-overlap' ? 105 : 100)
      assert.strictEqual(errors[0].previousSequence, gap.params.data.prev_change_id)
      assert.strictEqual(errors[0].sequence, gap.params.data.change_id)
    } finally {
      await messages.return?.()
      await cleanup()
    }
  })
}

for (const normalized of [false, true]) {
  for (const withDisconnects of [false, true]) {
    test(`Deribit depth recovery: normalized=${normalized}, disconnects=${withDisconnects}`, { timeout: 10000 }, async () => {
      const book = (type: string, change_id: number, prev_change_id?: number) => ({
        params: {
          channel: 'book.BTC-PERPETUAL.100ms',
          data: {
            type,
            instrument_name: 'BTC-PERPETUAL',
            change_id,
            ...(prev_change_id === undefined ? {} : { prev_change_id }),
            timestamp: 1794300000000,
            bids: [['new', 100, change_id]],
            asks: []
          }
        }
      })
      let connections = 0
      const initial = [book('snapshot', 100), book('change', 95, 94), book('change', 105, 98)],
        recovered = [...(normalized ? [] : [book('change', 999, 998)]), book('snapshot', 10), book('change', 9, 8), book('change', 12, 8)],
        errors: Error[] = []
      const { server, cleanup } = await createTestWebSocketServer('deribit')
      server.on('connection', (socket) => {
        const first = ++connections === 1
        socket.on('message', (bytes) => {
          if (JSON.parse(bytes.toString()).method.endsWith('/subscribe')) {
            for (const message of first ? [...initial, book('change', 110, 109)] : recovered) socket.send(JSON.stringify(message))
          }
        })
      })
      const options = { exchange: 'deribit' as const, timeoutIntervalMS: 0, onError: (error: Error) => errors.push(error) }
      const messages = normalized
        ? streamNormalized({ ...options, symbols: ['BTC-PERPETUAL'], withDisconnectMessages: withDisconnects }, normalizeBookChanges)
        : stream({ ...options, filters: [{ channel: 'book', symbols: ['BTC-PERPETUAL'] }], withDisconnects })
      const output: any[] = []
      try {
        for await (const message of messages) {
          output.push(message)
          if (output.length === (normalized ? 4 : initial.length + recovered.length) + (withDisconnects ? 1 : 0)) break
        }
        if (withDisconnects) {
          const index = normalized ? 2 : initial.length
          assert.strictEqual(normalized ? output[index].type : output[index], normalized ? 'disconnect' : undefined)
          output.splice(index, 1)
        }
        if (normalized) {
          assert.deepStrictEqual(
            output.map((m) => m.isSnapshot),
            [true, false, true, false]
          )
          assert.deepStrictEqual(
            output.map((m) => m.bids),
            [100, 105, 10, 12].map((amount) => [{ price: 100, amount }])
          )
        } else
          assert.deepStrictEqual(
            output.map((m) => m.message),
            [...initial, ...recovered]
          )
        assert.strictEqual(connections, 2)
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof SequenceGapError)
      } finally {
        await messages.return?.()
        await cleanup()
      }
    })
  }
}

test('Deribit normalized opt-out retains suppression of changes covered by a snapshot', { timeout: 10000 }, async () => {
  const errors: Error[] = [],
    { server, cleanup } = await createTestWebSocketServer('deribit')
  server.on('connection', (socket) =>
    socket.on('message', (bytes) => {
      if (!JSON.parse(bytes.toString()).method.endsWith('/subscribe')) return
      for (const [type, change_id, prev_change_id] of [
        ['snapshot', 100, undefined],
        ['change', 95, 94],
        ['change', 100, 98],
        ['change', 105, 98],
        ['change', 110, 109]
      ]) {
        socket.send(
          JSON.stringify({
            params: {
              channel: 'book.BTC-PERPETUAL.100ms',
              data: {
                type,
                change_id,
                prev_change_id,
                instrument_name: 'BTC-PERPETUAL',
                timestamp: 1794300000000,
                bids: [['new', 100, change_id]],
                asks: []
              }
            }
          })
        )
      }
    })
  )
  const messages = streamNormalized(
    {
      exchange: 'deribit',
      symbols: ['BTC-PERPETUAL'],
      timeoutIntervalMS: 0,
      validateSequence: false,
      onError: (error) => errors.push(error)
    },
    normalizeBookChanges
  )
  try {
    for (const amount of [100, 105, 110]) assert.deepStrictEqual((await messages.next()).value.bids, [{ price: 100, amount }])
    assert.deepStrictEqual(errors, [])
  } finally {
    await messages.return?.()
    await cleanup()
  }
})

for (const normalized of [false, true]) {
  for (const previous of [undefined, null]) {
    test(`Deribit missing link recovers: normalized=${normalized}, previous=${previous}`, { timeout: 10000 }, async () => {
      const book = (type: string, change_id: number, prev_change_id?: number | null) => ({
        params: {
          channel: 'book.BTC-PERPETUAL.100ms',
          data: {
            type,
            instrument_name: 'BTC-PERPETUAL',
            change_id,
            prev_change_id,
            timestamp: 1794300000000,
            bids: [['new', 100, change_id]],
            asks: []
          }
        }
      })
      let connections = 0
      const errors: Error[] = [],
        { server, cleanup } = await createTestWebSocketServer('deribit')
      server.on('connection', (socket) => {
        const first = ++connections === 1
        socket.on('message', (bytes) => {
          if (!JSON.parse(bytes.toString()).method.endsWith('/subscribe')) return
          for (const message of first
            ? [book('snapshot', 100), book('change', 105, 100), book('change', 110, previous)]
            : [book('snapshot', 10), book('change', 12, 10)])
            socket.send(JSON.stringify(message))
        })
      })
      const options = { exchange: 'deribit' as const, timeoutIntervalMS: 0, onError: (error: Error) => errors.push(error) }
      const messages = normalized
        ? streamNormalized({ ...options, symbols: ['BTC-PERPETUAL'], withDisconnectMessages: true }, normalizeBookChanges)
        : stream({ ...options, filters: [{ channel: 'book', symbols: ['BTC-PERPETUAL'] }], withDisconnects: true })
      const output: any[] = []
      try {
        for await (const message of messages) {
          output.push(message)
          if (output.length === 5) break
        }
        assert.strictEqual(normalized ? output[2].type : output[2], normalized ? 'disconnect' : undefined)
        output.splice(2, 1)
        assert.deepStrictEqual(
          output.map((message) => (normalized ? message.bids[0].amount : message.message.params.data.change_id)),
          [100, 105, 10, 12]
        )
        assert.strictEqual(connections, 2)
        assert.strictEqual(errors.length, 1)
        assert.strictEqual(errors[0].message, 'Deribit book change is missing prev_change_id')
      } finally {
        await messages.return?.()
        await cleanup()
      }
    })
  }
}

test('Deribit duplicates with missing links preserve normalized book levels', { timeout: 10000 }, async () => {
  const errors: Error[] = [],
    { server, cleanup } = await createTestWebSocketServer('deribit')
  server.on('connection', (socket) =>
    socket.on('message', (bytes) => {
      if (!JSON.parse(bytes.toString()).method.endsWith('/subscribe')) return
      const book = (type: string, change_id: number, bids: (string | number)[][], prev_change_id?: number | null) => ({
        params: {
          channel: 'book.BTC-PERPETUAL.100ms',
          data: { type, instrument_name: 'BTC-PERPETUAL', change_id, prev_change_id, timestamp: 1794300000000, bids, asks: [] }
        }
      })
      for (const message of [
        book('snapshot', 100, [['new', 100, 1]]),
        book('change', 105, [['new', 99, 2]], 100),
        book('change', 105, [['change', 99, 2]]),
        book('change', 105, [['change', 99, 2]], null),
        book('change', 110, [['new', 98, 3]], 105)
      ])
        socket.send(JSON.stringify(message))
    })
  )
  const messages = streamNormalized(
    { exchange: 'deribit', symbols: ['BTC-PERPETUAL'], timeoutIntervalMS: 0, onError: (error) => errors.push(error) },
    normalizeBookChanges
  )
  const book = new OrderBook()
  try {
    for (const isSnapshot of [true, false, false, false, false]) {
      const next = (await messages.next()).value
      assert.strictEqual(next.isSnapshot, isSnapshot)
      book.update(next)
    }
    assert.deepStrictEqual(
      [...book.bids()],
      [
        { price: 100, amount: 1 },
        { price: 99, amount: 2 },
        { price: 98, amount: 3 }
      ]
    )
    assert.deepStrictEqual(errors, [])
  } finally {
    await messages.return?.()
    await cleanup()
  }
})

test('Deribit retains untyped and zero-ID legacy snapshot compatibility', () => {
  const timestamp = new Date('2020-01-01'),
    mapper = normalizeBookChanges('deribit', timestamp)
  const book = (change_id: number, prev_change_id?: number, type?: string) => ({
    params: {
      channel: 'book.BTC-PERPETUAL.raw',
      data: { instrument_name: 'BTC-PERPETUAL', timestamp: timestamp.valueOf(), change_id, prev_change_id, type, bids: [], asks: [] }
    }
  })
  for (const message of [book(100), book(200, 0), book(0, undefined, 'snapshot')]) {
    const changes = [...mapper.map(message, timestamp)!]
    assert.strictEqual(changes.length, 1)
    assert.strictEqual(changes[0].isSnapshot, true)
  }
  const changes = [...mapper.map(book(1, 0, 'change'), timestamp)!]
  assert.strictEqual(changes.length, 1)
  assert.strictEqual(changes[0].isSnapshot, true)
})
