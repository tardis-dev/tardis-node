import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { mock, test } from 'node:test'
import { type WebSocket, WebSocketServer } from 'ws'
import * as handy from '../dist/handy.js'
import { assert } from './assertions.ts'

// Each depth update sets one of ten bid levels to an amount equal to its update id, so the book at any update id is known.
const books = new Map(['BTCUSDT', 'ETHUSDT'].map((symbol) => [symbol, { updateId: 0, levels: new Map<string, string>() }]))
const priceFor = (updateId: number) => 100 + (updateId % 10)

function levelsAt(updateId: number) {
  const levels = new Map<number, number>()
  for (let id = Math.max(1, updateId - 9); id <= updateId; id++) {
    levels.set(priceFor(id), id)
  }
  return levels
}

mock.module('../dist/handy.js', {
  exports: {
    ...handy,
    getJSON: async (url: string) => {
      const { pathname, searchParams } = new URL(url)
      if (pathname.endsWith('/exchangeInfo')) {
        return { data: { rateLimits: [{ rateLimitType: 'REQUEST_WEIGHT', limit: 2400 }] }, headers: {} }
      }

      const symbol = searchParams.get('symbol')!
      if (pathname.endsWith('/depth')) {
        const book = books.get(symbol)!
        return { data: { lastUpdateId: book.updateId, bids: [...book.levels], asks: [] }, headers: {} }
      }

      return { data: { symbol, openInterest: '1', time: Date.now() }, headers: {} }
    }
  }
})

const { normalizeBookChanges, normalizeDerivativeTickers, normalizeTrades, streamNormalized } = await import('../dist/index.js')

type ExchangeConnection = { id: number; path: string; socket: WebSocket; streams: Set<string> }

test('a dropped Binance futures connection restarts every connection and book from a snapshot', { timeout: 15_000 }, async () => {
  const connections: ExchangeConnection[] = []
  let rejectNextMarketConnection = false
  let rejectedMarketConnections = 0
  const server = new WebSocketServer({
    port: 0,
    verifyClient: (info, accept) => {
      if (rejectNextMarketConnection && info.req.url!.startsWith('/market')) {
        rejectNextMarketConnection = false
        rejectedMarketConnections++
        accept(false, 503)
      } else {
        accept(true)
      }
    }
  })
  await once(server, 'listening')
  const previousUrl = process.env.WSS_URL_BINANCE_FUTURES
  process.env.WSS_URL_BINANCE_FUTURES = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`

  server.on('connection', (socket, request) => {
    const connection = { id: connections.length + 1, path: request.url!, socket, streams: new Set<string>() }
    connections.push(connection)
    socket.on('message', (payload) => {
      const { params, id } = JSON.parse(payload.toString())
      params.forEach((stream: string) => connection.streams.add(stream))
      socket.send(JSON.stringify({ result: null, id }))
    })
  })

  const send = (stream: string, data: (connection: ExchangeConnection) => object) => {
    for (const connection of connections) {
      if (connection.socket.readyState === connection.socket.OPEN && connection.streams.has(stream)) {
        connection.socket.send(JSON.stringify({ stream, data: data(connection) }))
      }
    }
  }

  const publishing = setInterval(() => {
    for (const [s, book] of books) {
      const u = ++book.updateId
      const price = String(priceFor(u))
      book.levels.set(price, String(u))
      const symbol = s.toLowerCase()
      const E = Date.now()
      send(`${symbol}@depth@0ms`, () => ({ e: 'depthUpdate', E, T: E, s, U: u, u, pu: u - 1, b: [[price, String(u)]], a: [] }))
      // trade ids and index prices carry the id of the connection that delivered them
      send(`${symbol}@trade`, (c) => ({ e: 'trade', E, T: E, s, t: c.id * 1_000_000 + u, p: price, q: '1', m: false }))
      send(`${symbol}@markPrice@1s`, (c) => ({ e: 'markPriceUpdate', E, s, p: String(u), i: String(c.id), r: '0.0001', T: E }))
    }
  }, 5)

  const messages = streamNormalized(
    { exchange: 'binance-futures', symbols: ['btcusdt', 'ethusdt'], withDisconnectMessages: true },
    normalizeTrades,
    normalizeBookChanges,
    normalizeDerivativeTickers
  )

  const output: any[] = []
  const receivedAt: number[] = []
  let dropped: ExchangeConnection | undefined
  let connectionsBeforeLastDisconnect = 0
  const bookChangesFrom = (index: number, symbol: string) =>
    output.slice(index).filter((m) => m.type === 'book_change' && m.symbol === symbol)
  const updatedFromSnapshot = (index: number, minUpdates: number) =>
    [...books.keys()].every((symbol) => {
      const [snapshot, ...updates] = bookChangesFrom(index, symbol)
      return snapshot?.isSnapshot === true && updates.length >= minUpdates
    })

  try {
    const deadline = Date.now() + 5_000
    for await (const message of messages) {
      output.push(message)
      receivedAt.push(Date.now())
      if (Date.now() > deadline) break
      if (message.type === 'disconnect') connectionsBeforeLastDisconnect = connections.length

      if (dropped === undefined) {
        if (updatedFromSnapshot(0, 5)) {
          dropped = connections.find((c) => c.path.startsWith('/market'))!
          rejectNextMarketConnection = true
          dropped.socket.terminate()
        }
      } else if (rejectedMarketConnections === 1) {
        const disconnect = output.findLastIndex((m) => m.type === 'disconnect')
        const marketDelivered = output.slice(disconnect).some((m) => m.type === 'derivative_ticker')
        if (disconnect !== -1 && marketDelivered && updatedFromSnapshot(disconnect, 20)) break
      }
    }
  } finally {
    clearInterval(publishing)
    await messages.return?.()
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (previousUrl === undefined) delete process.env.WSS_URL_BINANCE_FUTURES
    else process.env.WSS_URL_BINANCE_FUTURES = previousUrl
  }

  assert.ok(dropped !== undefined, 'books must start before the /market connection is dropped')
  const disconnects = output.flatMap((m, index) => (m.type === 'disconnect' ? [index] : []))
  assert.ok(disconnects.length > 0, 'the dropped connection must produce a disconnect')
  const afterDisconnect = output.slice(disconnects.at(-1)! + 1)

  for (const symbol of books.keys()) {
    const [snapshot, ...updates] = bookChangesFrom(disconnects.at(-1)! + 1, symbol)
    assert.equal(snapshot?.isSnapshot, true, `${symbol} must restart from a snapshot after the disconnect`)
    let updateId = Math.max(...snapshot.bids.map((level: any) => level.amount))
    assert.deepEqual(new Map(snapshot.bids.map((level: any) => [level.price, level.amount])), levelsAt(updateId))
    assert.ok(updates.length >= 20, `${symbol} book must keep updating after the disconnect, got ${updates.length} updates`)
    for (const [index, update] of updates.entries()) {
      // Binance futures keeps the event ending at the snapshot lastUpdateId, which repeats absolute amounts
      if (index === 0 && update.bids[0].amount === updateId) continue
      updateId++
      assert.deepEqual(update.bids, [{ price: priceFor(updateId), amount: updateId }], `${symbol} update ${updateId}`)
    }
  }

  const oldConnection = (id: number) => id <= connectionsBeforeLastDisconnect
  assert.deepEqual(
    afterDisconnect.filter((m) => m.type === 'trade' && oldConnection(Math.floor(Number(m.id) / 1_000_000))),
    [],
    'no trade from a connection opened before the disconnect may follow it'
  )
  assert.deepEqual(
    afterDisconnect.filter((m) => m.type === 'derivative_ticker' && oldConnection(m.indexPrice)),
    [],
    'no ticker from a connection opened before the disconnect may follow it'
  )

  assert.equal(disconnects.length, 2, 'the dropped connection and the rejected reconnect each restart the feed once')
  const [, rejected] = disconnects
  assert.ok(
    receivedAt[rejected + 1] - receivedAt[rejected] >= 900,
    'the feed opens again only after the retry delay of the rejected connection'
  )
})
