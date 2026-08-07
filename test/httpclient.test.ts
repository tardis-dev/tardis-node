import { test } from 'node:test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { getJSON, postJSON } from '../dist/handy.js'
import { assert } from './assertions.ts'

test('retries a temporary GET failure and returns the HTTP response', async () => {
  let requestsCount = 0
  const server = await startServer((_request, response) => {
    requestsCount++
    if (requestsCount === 1) {
      response.writeHead(503, { 'Retry-After': '0' }).end('temporary failure')
      return
    }

    response.writeHead(200, { 'Content-Type': 'application/json', 'X-Test-Header': '123' }).end(JSON.stringify({ ok: true }))
  })

  try {
    const result = await getJSON<{ ok: boolean }>(`${server.url}/json`)

    assert.strictEqual(requestsCount, 2)
    assert.strictEqual(result.statusCode, 200)
    assert.strictEqual(result.headers['x-test-header'], '123')
    assert.deepStrictEqual(result.data, { ok: true })
  } finally {
    await server.close()
  }
})

test('sends a JSON POST body and retries when requested', async () => {
  const requests: { method: string | undefined; body: string }[] = []
  const server = await startServer(async (request, response) => {
    requests.push({ method: request.method, body: await readBody(request) })
    if (requests.length === 1) {
      response.writeHead(503, { 'Retry-After': '0' }).end('temporary failure')
      return
    }

    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }))
  })

  try {
    const result = await postJSON<{ ok: boolean }>(`${server.url}/post`, { body: { ping: 'pong' }, retry: 3 })

    assert.deepStrictEqual(requests, [
      { method: 'POST', body: '{"ping":"pong"}' },
      { method: 'POST', body: '{"ping":"pong"}' }
    ])
    assert.deepStrictEqual(result.data, { ok: true })
  } finally {
    await server.close()
  }
})

async function startServer(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error) => response.destroy(error))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))))
  }
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString()
}
