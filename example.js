import {
  normalizeBookChanges,
  normalizeBookTickers,
  normalizeDerivativeTickers,
  normalizeLiquidations,
  normalizeOptionsSummary,
  normalizeTrades,
  init,
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
  node example.js stream <exchange> <channel> [symbol]
  node example.js replay <exchange> <channel> <from> <to> [symbol]

Options:
  --normalized       use normalized <data-type> instead of native <channel>
  --endpoint <url>   override API endpoint, default: https://api.tardis.dev/v1
                     local API example: http://127.0.0.1:8787/v1
  --api-key <key>    override API key, default: TARDIS_DEV_API_KEY env var
                     local API example: TD.LOCAL.DEV.API.KEY
  --limit <n>        stop after n messages

Examples:
  node example.js stream mexc-futures push.depth BTC_USDT
  node example.js replay mexc-futures push.depth 2026-06-17 2026-06-18 BTC_USDT
  node example.js --normalized stream mexc-futures book_change BTC_USDT
  node example.js --normalized replay mexc-futures book_change 2026-06-17 2026-06-18 BTC_USDT
  node example.js --endpoint http://127.0.0.1:8787/v1 --api-key TD.LOCAL.DEV.API.KEY --limit 3 replay gemini trade 2026-07-20T15:45:00.000Z 2026-07-20T15:46:00.000Z`)
  process.exit(1)
}

init(options.init)

let messagesCount = 0
for await (const message of createMessageStream(options)) {
  if (message === undefined || message?.type === 'disconnect') {
    console.log({ type: 'disconnect' })
  } else {
    console.log(message)
  }

  messagesCount++
  if (options.limit !== undefined && messagesCount >= options.limit) {
    break
  }
}

function getOptions(args) {
  const options = parseOptions(args)
  const normalized = options.positionals.includes('--normalized')
  const [mode, exchange, channelOrDataType, streamSymbolOrReplayFrom, to, replaySymbol] = options.positionals.filter(
    (arg) => arg !== '--normalized'
  )
  const symbol = mode === 'stream' ? streamSymbolOrReplayFrom : replaySymbol
  const from = mode === 'replay' ? streamSymbolOrReplayFrom : undefined

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
    symbols: symbol === undefined ? undefined : [symbol],
    channel: normalized ? undefined : channelOrDataType,
    dataType: normalized ? channelOrDataType : undefined,
    normalizer: normalized ? normalizersByDataType[channelOrDataType] : undefined,
    from,
    to,
    init: {
      ...(options.values.endpoint === undefined ? {} : { endpoint: options.values.endpoint }),
      ...(options.values.apiKey === undefined ? {} : { apiKey: options.values.apiKey })
    },
    limit: options.values.limit === undefined ? undefined : Number(options.values.limit)
  }
}

/**
 * @param {string[]} args
 * @returns {{ values: Record<string, string>, positionals: string[] }}
 */
function parseOptions(args) {
  const valueOptions = ['endpoint', 'api-key', 'limit'].map((name) => `--${name}`)
  const result = { values: {}, positionals: [] }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (valueOptions.includes(arg)) {
      const value = args[++i]
      if (value === undefined) {
        throw new Error(`Missing value for ${arg}.`)
      }

      result.values[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value
      continue
    }

    result.positionals.push(arg)
  }

  return result
}

function getOptionsError(options) {
  if (options.mode !== 'stream' && options.mode !== 'replay') {
    return 'Missing or invalid mode. Expected "stream" or "replay".'
  }
  if (options.exchange === undefined) {
    return 'Missing exchange name.'
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
          symbols: options.symbols,
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
        symbols: options.symbols,
        from: options.from,
        to: options.to,
        withDisconnectMessages: true
      },
      options.normalizer
    )
  }

  const nativeFilters = [{ channel: options.channel, ...(options.symbols === undefined ? {} : { symbols: options.symbols }) }]
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
