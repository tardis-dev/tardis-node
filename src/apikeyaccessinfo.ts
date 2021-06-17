import { httpClient } from './handy'
import { getOptions } from './options'
import { Exchange } from './types'

export async function getApiKeyAccessInfo(apiKey?: string) {
  const options = getOptions()
  const apiKeyToCheck = apiKey || options.apiKey

  const apiKeyAccessInfo = await httpClient
    .get(`${options.endpoint}/api-key-info`, {
      headers: {
        Authorization: `Bearer ${apiKeyToCheck}`
      }
    })
    .json()

  return apiKeyAccessInfo as ApiKeyAccessInfo
}

export type ApiKeyAccessInfo = {
  exchange: Exchange
  from: string
  to: string
  symbols: string[]
}[]
