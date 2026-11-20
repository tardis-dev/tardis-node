import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import type { Exchange } from '../../dist/types.js'
import { assert } from '../assertions.ts'

export async function createTestWebSocketServer(exchange?: Exchange) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')

  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')

  const wssURL = `ws://127.0.0.1:${address.port}`
  const envKey = exchange === undefined ? undefined : `WSS_URL_${exchange.toUpperCase().replaceAll('-', '_')}`
  const previousURL = envKey === undefined ? undefined : process.env[envKey]
  if (envKey !== undefined) {
    process.env[envKey] = wssURL
  }

  return {
    server,
    wssURL,
    async cleanup() {
      if (envKey !== undefined) {
        if (previousURL === undefined) {
          delete process.env[envKey]
        } else {
          process.env[envKey] = previousURL
        }
      }

      for (const socket of server.clients) {
        socket.terminate()
      }

      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  }
}
