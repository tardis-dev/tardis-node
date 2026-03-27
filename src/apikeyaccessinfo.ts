import { getJSON } from './handy.ts'
import { getOptions } from './options.ts'
import { Exchange } from './types.ts'

export async function getApiKeyAccessInfo(apiKey?: string) {
  const options = getOptions()
  const apiKeyToCheck = apiKey || options.apiKey

  const { data } = await getJSON<ApiKeyAccessInfo>(`${options.endpoint}/api-key-info`, {
    headers: {
      Authorization: `Bearer ${apiKeyToCheck}`
    }
  })

  return data
}

export type ApiKeyAccessInfo = {
  exchange: Exchange
  accessType: string
  from: string
  to: string
  symbols: string[]
  dataPlan: string
}[]
