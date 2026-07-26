import { jest } from '@jest/globals'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { download, getJSON, postJSON } from '../dist/handy.js'

function createFetchMock(...responses: Response[]) {
  const fetchMock = jest.fn<typeof fetch>()

  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }

  return fetchMock
}

describe('getJSON', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  test('returns parsed body and normalized headers', async () => {
    global.fetch = createFetchMock(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'X-Test-Header': '123'
        }
      })
    )

    const response = await getJSON<{ ok: boolean }>('https://example.com/test')

    expect(response.statusCode).toBe(200)
    expect(response.headers['x-test-header']).toBe('123')
    expect(response.data).toEqual({ ok: true })
  })

  test('returns parsed JSON data and metadata together', async () => {
    global.fetch = createFetchMock(
      new Response(JSON.stringify({ ok: true }), {
        status: 200
      })
    )

    await expect(getJSON<{ ok: boolean }>('https://example.com/chained')).resolves.toMatchObject({
      statusCode: 200,
      data: { ok: true }
    })
  })

  test('retries retryable GET responses', async () => {
    jest.useFakeTimers()

    global.fetch = createFetchMock(
      new Response('temporary failure', { status: 503 }),
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )

    const responsePromise = getJSON<{ ok: boolean }>('https://example.com/retry')

    await jest.runAllTimersAsync()

    const response = await responsePromise

    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(response.data).toEqual({ ok: true })
  })

  test('retries POST responses when retry is configured explicitly', async () => {
    jest.useFakeTimers()

    global.fetch = createFetchMock(
      new Response('temporary failure', { status: 503 }),
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )

    const responsePromise = postJSON<{ ok: boolean }>('https://example.com/retry-post', { retry: 3 })

    await Promise.resolve()
    await jest.runAllTimersAsync()

    const response = await responsePromise

    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(response.data).toEqual({ ok: true })
  })

  test('sends JSON request bodies for POST', async () => {
    global.fetch = createFetchMock(
      new Response(JSON.stringify({ ok: true }), {
        status: 200
      })
    )

    await postJSON<{ ok: boolean }>('https://example.com/post-body', {
      body: { ping: 'pong' }
    })

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/post-body',
      expect.objectContaining({
        method: 'POST',
        body: '{"ping":"pong"}',
        headers: expect.objectContaining({
          'Content-Type': 'application/json'
        })
      })
    )
  })

  test('does not retry 413 by default', async () => {
    global.fetch = createFetchMock(
      new Response('payload too large', { status: 413 }),
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )

    await expect(getJSON('https://example.com/too-large')).rejects.toMatchObject({
      response: {
        statusCode: 413,
        body: 'payload too large'
      }
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  test('throws response metadata for non-retryable errors', async () => {
    global.fetch = createFetchMock(new Response('bad request', { status: 400 }))

    await expect(getJSON('https://example.com/error')).rejects.toMatchObject({
      response: {
        statusCode: 400,
        body: 'bad request'
      }
    })
  })
})

test('downloads from an HTTP endpoint', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-http-download-'))
  const downloadPath = path.join(tempDir, 'slice')
  const server = createServer((_request, response) => response.end('slice contents'))

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Expected an HTTP server address')
    }

    await download({
      apiKey: '',
      downloadPath,
      url: `http://127.0.0.1:${address.port}/slice`,
      userAgent: 'tardis-node-test'
    })

    expect(readFileSync(downloadPath, 'utf8')).toBe('slice contents')
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))))
    rmSync(tempDir, { recursive: true, force: true })
  }
})
