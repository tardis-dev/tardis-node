import {
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
  node example.js --normalized stream <exchange> <symbol> <data-type>
  node example.js --normalized replay <exchange> <symbol> <data-type> <from> <to>

Examples:
  node example.js stream mexc-futures BTC_USDT push.depth
  node example.js replay mexc-futures BTC_USDT push.depth 2026-06-17 2026-06-18
  node example.js --normalized stream mexc-futures BTC_USDT book_change
  node example.js --normalized replay mexc-futures BTC_USDT book_change 2026-06-17 2026-06-18`)
  process.exit(1)
}

for await (const message of createMessageStream(options)) {
  if (message === undefined || message?.type === 'disconnect') {
    console.log({ type: 'disconnect' })
    continue
  }

  console.log(message)
}

function getOptions(args) {
  const normalized = args.includes('--normalized')
  const positionalArgs = args.filter((arg) => arg !== '--normalized')

  const normalizersByDataType = {
    trade: normalizeTrades,
    book_change: normalizeBookChanges,
    derivative_ticker: normalizeDerivativeTickers,
    option_summary: normalizeOptionsSummary,
    liquidation: normalizeLiquidations,
    book_ticker: normalizeBookTickers
  }

  return {
    mode: positionalArgs[0], // 'stream' or 'replay'
    normalized,
    exchange: positionalArgs[1],
    symbols: [positionalArgs[2]],
    channel: normalized ? undefined : positionalArgs[3],
    dataType: normalized ? positionalArgs[3] : undefined,
    normalizer: normalized ? normalizersByDataType[positionalArgs[3]] : undefined,
    from: positionalArgs[4],
    to: positionalArgs[5]
  }
}

function getOptionsError(options) {
  if (options.mode !== 'stream' && options.mode !== 'replay') {
    return 'Missing or invalid mode. Expected "stream" or "replay".'
  }
  if (options.exchange === undefined) {
    return 'Missing exchange name.'
  }
  if (options.symbols[0] === undefined) {
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

  const nativeFilters = [{ channel: options.channel, symbols: options.symbols }]
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
