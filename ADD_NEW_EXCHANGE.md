# Adding a New Exchange

## Overview

Adding an exchange to tardis-node requires three things: mappers (transform raw exchange messages into normalized types), a real-time feed (WebSocket connection), and constant definitions.

## Workflow

### 1. Add exchange constants

In `src/consts.ts`:

- Add exchange ID to the exchanges array
- Add every channel exposed by the Exchanges API. For hosted exchanges, use `https://api.tardis.dev/v1/exchanges/{exchange}`. If the exchange is not hosted yet, check the exchange definition in `../tardis-api/src/routes/exchanges/{exchange}.ts`.

### 2. Create mappers

Create `src/mappers/{exchange}.ts`. Each mapper class implements the Mapper interface — look at existing mapper implementations to find an exchange with a similar message format.

Before coding, inspect the contract in this order:

1. Hosted Exchanges API: `https://api.tardis.dev/v1/exchanges/{exchange}` owns the current channels, symbol ids, and instrument classification for hosted exchanges.
2. If the exchange is not hosted yet, use `../tardis-api/src/routes/exchanges/{exchange}.ts`.
3. `src/types.ts` owns normalized TypeScript shapes.
4. `src/mappers/{exchange}.ts` owns mapper registration, normalizer coverage, and date-based API version selection for that exchange. `src/mappers/index.ts` only aggregates exchange mapper registries.
5. Official exchange docs and captured raw messages own upstream payload meaning.

Make a coverage table from the channels exposed by the Exchanges API, exchange docs, captured WebSocket messages, and recorded raw replay when available. `sourceFor` is supporting context: use it to understand why a channel sources a normalized type, not as a replacement for inspecting the channel payload.

For each channel and message variant, record the message role, exact mapper action, and concrete evidence for the decision. Evidence should point to a docs section, captured payload, replay range, or test case. Do not infer the role from the channel name alone; exchanges use different conventions for snapshots, deltas, events, subscription acknowledgements, cached payloads, and status messages.

Use this shape in the PR description or implementation notes:

| Channel | Message variants | Role | Normalizer | Mapper action | Evidence / test payload |
| ------- | ---------------- | ---- | ---------- | ------------- | ----------------------- |
|         |                  |      |            |               |                         |

Mappers to implement depend on what the exchange provides: trades, book changes, tickers, derivative tickers, liquidations, book tickers, options summaries, etc. Do not stop at the channel list; inspect the fields each channel carries and map every supported normalized type. Use [NORMALIZED_MAPPING_GUIDELINES.md](NORMALIZED_MAPPING_GUIDELINES.md) for normalized field semantics.

Mapper decisions to make explicit:

- **Symbols** — use the same exchange symbol value across mapper output, replay filters, real-time subscription filters, and customer-facing filters. If the exchange exposes more than one identifier, choose the identifier used by the Exchanges API and keep conversions explicit.
- **Filters** — implement `getFilters()` for each mapper to request the channels needed by that normalizer in `replayNormalized()` and `streamNormalized()`. Return only channels defined for that exchange in `src/consts.ts`.
- **Message roles** — map snapshots, deltas, trades, ticker updates, status messages, and acknowledgements according to the exchange contract, not the channel name alone.
- **Generated snapshots** — when `normalizeBookChanges()` needs a generated or REST-backed snapshot, prove the snapshot can synchronize with buffered deltas in both real-time and replay paths.
- **Partial feeds** — when a normalized output is built from multiple partial messages, document which message owns the output timestamp, which messages only update cached state, and any partial message intentionally chosen as an output source.

Export an `{exchange}Mappers` registry from `src/mappers/{exchange}.ts` with `exchangeMappers()`.

- Use existing exchange IDs and mapper-kind keys; registry keys are validated.
- Use plain factories for stable mappings, for example `trades: () => new ExchangeTradesMapper()`.
- If a mapper constructor needs configuration beyond the exchange ID, pass a named options object, for example `new ExchangeBookChangeMapper('exchange', { depth: 50 })`.
- Use `mapper([{ until, use }, { use }])` only when the exchange changed mapper behavior over time.
- Register the registry in `src/mappers/index.ts`.

### 3. Create real-time feed

Create `src/realtimefeeds/{exchange}.ts`. Extend `RealTimeFeedBase` with:

- WebSocket URL
- Subscription message format
- Any exchange-specific hooks (decompression, heartbeat handling, error filtering)

Register in `src/realtimefeeds/index.ts`.

### 4. Test

Add mapper tests in `test/mappers.test.ts` using real exchange payloads copied from docs or captured WebSocket messages. Keep them in the shared mapper snapshot test unless the exchange needs unusual replay behavior.

Mapper tests should cover:

- every mapper registered for the exchange
- each normalized data type the exchange supports
- representative message variants for each mapped channel
- order book snapshot and delta behavior, when the exchange provides both
- message variants that should intentionally emit nothing
- numeric edge cases from [EXCHANGE_NUMERIC_FIELDS.md](EXCHANGE_NUMERIC_FIELDS.md)
- separate price/index/underlying messages that update mapper state without directly emitting normalized output
- no `NaN`, `Infinity`, invalid `Date`, or schema-required `undefined` values in emitted normalized messages

Run tests and validation — see AGENTS.md for the full checklist.

### 5. Validate live and replay output

After adding or changing a real-time feed, mapper, filter, or upstream API version branch, validate the implementation against actual data in addition to mapper snapshots. Build first because `example.js` imports `dist/index.js`.

```bash
npm run build
```

Use `example.js` to check native and normalized output for at least one active symbol and each channel or normalized data type touched by the change. See [AGENTS.md](AGENTS.md) for the manual replay script requirement.

```bash
node example.js stream <exchange> <symbol> <channel>
node example.js --normalized stream <exchange> <symbol> <data-type>
node example.js replay <exchange> <symbol> <channel> <from> <to>
node example.js --normalized replay <exchange> <symbol> <data-type> <from> <to>
```

For order book changes, confirm the expected snapshot behavior: snapshot-capable feeds should emit an initial `book_change` with `isSnapshot=true`, then deltas with `isSnapshot=false` when the exchange contract provides deltas. For trades, tickers, liquidations, and other mapped data types, confirm that messages are produced for the requested symbol and that key fields are populated from the documented exchange semantics.

For order book changes, also confirm that the first snapshot version can be synchronized with the first emitted deltas for both real-time and replay paths. For trades, confirm whether the first trade message is a true incremental trade or a recent-trades backfill that should not be normalized.

If a channel is intentionally state-only or should emit nothing for a message variant, validate the paired channel or later payload that should produce the normalized output. Record the symbol, time range, raw channel, normalized type, and any skipped live or replay checks in the PR notes.

## Decision Points

- **Date-based mapper versioning** — If the exchange changed its raw API format at some point, define the switch in the exchange mapper registry with `mapper([{ until, use }, { use }])`. Use separate mapper classes for each raw format even when public Tardis channel names stayed the same. Look at existing `*Mappers` exports in `src/mappers/{exchange}.ts` files for the pattern.
- **Multi-connection feeds** — Some exchanges need multiple WebSocket connections. The base class supports this via `MultiConnectionRealTimeFeedBase`.
- **Decompression** — Some exchanges compress WebSocket messages. Override the decompress hook if needed.
- **Filter optimization** — The base class has `optimizeFilters()` for normalizing subscription filters. Override if the exchange needs special handling.
