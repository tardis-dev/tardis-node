import { parseArgs } from 'node:util'
import {
  init,
  normalizeBookChanges,
  normalizeBookTickers,
  normalizeDerivativeTickers,
  normalizeLiquidations,
  normalizeOptionsSummary,
  normalizeTrades,
  replay,
  replayNormalized,
  stream,
  streamNormalized
} from './dist/index.js'

const options = getOptions(process.argv.slice(2))
const optionsError = getOptionsError(options)
if (optionsError !== undefined) {
  console.error(`${optionsError}

Usage:
  node example.js stream <exchange> <symbol> <channel>
  node example.js replay <exchange> <symbol> <channel> <from> <to>

Options:
  --normalized       use normalized <data-type> instead of native <channel>
  --endpoint <url>   override API endpoint, default: https://api.tardis.dev/v1
                     local API example: http://127.0.0.1:8787/v1
  --api-key <key>    override API key, default: TARDIS_DEV_API_KEY env var
                     local API example: TD.LOCAL.DEV.API.KEY
  --limit <n>        stop after n messages

Examples:
  node example.js stream mexc-futures BTC_USDT push.depth
  node example.js replay mexc-futures BTC_USDT push.depth 2026-06-17 2026-06-18
  node example.js --normalized stream mexc-futures BTC_USDT book_change
  node example.js --normalized replay mexc-futures BTC_USDT book_change 2026-06-17 2026-06-18`)
  process.exit(1)
}

init(options.init)

let messagesCount = 0
for await (const message of createMessageStream(options)) {
  if (message === undefined || message?.type === 'disconnect') {
    console.log({ type: 'disconnect' })
    continue
  }

  console.log(message)
  messagesCount++
  if (options.limit !== undefined && messagesCount >= options.limit) {
    break
  }
}

function getOptions(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      normalized: { type: 'boolean' },
      endpoint: { type: 'string' },
      'api-key': { type: 'string' },
      limit: { type: 'string' }
    },
    allowPositionals: true
  })
  const [mode, exchange, symbol, channelOrDataType, from, to] = positionals
  const normalized = values.normalized === true
  const apiKey = values['api-key'] ?? process.env.TARDIS_DEV_API_KEY

  const normalizersByDataType = {
    trade: normalizeTrades,
    book_change: normalizeBookChanges,
    derivative_ticker: normalizeDerivativeTickers,
    option_summary: normalizeOptionsSummary,
    liquidation: normalizeLiquidations,
    book_ticker: normalizeBookTickers
  }

  return {
    mode, // 'stream' or 'replay'
    normalized,
    exchange,
    symbol,
    channel: normalized ? undefined : channelOrDataType,
    dataType: normalized ? channelOrDataType : undefined,
    normalizer: normalized ? normalizersByDataType[channelOrDataType] : undefined,
    from,
    to,
    init: {
      ...(values.endpoint === undefined ? {} : { endpoint: values.endpoint }),
      ...(apiKey === undefined ? {} : { apiKey })
    },
    limit: values.limit === undefined ? undefined : Number(values.limit)
  }
}

function getOptionsError(options) {
  if (options.mode !== 'stream' && options.mode !== 'replay') {
    return 'Missing or invalid mode. Expected "stream" or "replay".'
  }
  if (options.exchange === undefined) {
    return 'Missing exchange name.'
  }
  if (options.symbol === undefined) {
    return 'Missing symbol.'
  }
  if (options.normalized && options.dataType === undefined) {
    return 'Missing normalized data type.'
  }
  if (options.normalized === false && options.channel === undefined) {
    return 'Missing native channel.'
  }
  if (options.normalized && options.normalizer === undefined) {
    return `Invalid normalized data type "${options.dataType}".`
  }
  if (options.mode === 'replay' && (options.from === undefined || options.to === undefined)) {
    return 'Replay mode requires from and to dates.'
  }
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit <= 0)) {
    return 'Invalid limit. Expected a positive integer.'
  }
}

function createMessageStream(options) {
  if (options.normalized) {
    if (options.mode === 'stream') {
      return streamNormalized(
        {
          exchange: options.exchange,
          symbols: [options.symbol],
          timeoutIntervalMS: 20_000,
          withDisconnectMessages: true,
          onError: (error) => console.error(`[${options.exchange}] ${error.message}`)
        },
        options.normalizer
      )
    }

    return replayNormalized(
      {
        exchange: options.exchange,
        symbols: [options.symbol],
        from: options.from,
        to: options.to,
        withDisconnectMessages: true
      },
      options.normalizer
    )
  }

  const nativeFilters = [{ channel: options.channel, symbols: [options.symbol] }]
  if (options.mode === 'stream') {
    return stream({
      exchange: options.exchange,
      filters: nativeFilters,
      timeoutIntervalMS: 20_000,
      withDisconnects: true,
      onError: (error) => console.error(`[${options.exchange}] ${error.message}`)
    })
  }

  return replay({
    exchange: options.exchange,
    from: options.from,
    to: options.to,
    filters: nativeFilters,
    withDisconnects: true
  })
}
