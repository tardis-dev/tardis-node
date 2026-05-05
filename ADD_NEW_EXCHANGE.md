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
4. `src/mappers/index.ts` owns mapper registration, normalizer coverage, and date-based API version selection.
5. Official exchange docs and captured raw messages own upstream payload meaning.

Make a coverage table from the channels exposed by the Exchanges API, exchange docs, and captured WebSocket messages. `sourceFor` is supporting context: use it to understand why a channel sources a normalized type, not as a replacement for inspecting the channel payload. For each channel and message variant, record the message role and the exact mapper action. Do not infer the role from the channel name alone; exchanges use different conventions for snapshots, deltas, events, subscription acknowledgements, cached payloads, and status messages.

Use this shape in the PR description or implementation notes:

| Channel | Message variants | Role | Normalizer | Mapper action | Test payload |
| ------- | ---------------- | ---- | ---------- | ------------- | ------------ |
|         |                  |      |            |               |              |

Mappers to implement depend on what the exchange provides: trades, book changes, tickers, derivative tickers, liquidations, book tickers, options summaries, etc. Do not stop at the channel list — inspect the fields each channel carries and map every supported normalized type. For example, a native ticker channel may produce `BookTicker`, while market stats may produce `DerivativeTicker`.

Mapper decisions to make explicit:

- **Symbols** — use the same exchange symbol value across mapper output, replay filters, real-time subscription filters, and customer-facing filters. If the exchange exposes more than one identifier, choose the identifier used by the Exchanges API and keep conversions explicit.
- **Filters** — implement `getFilters()` for each mapper to request the channels needed by that normalizer in `replayNormalized()` and `streamNormalized()`. Return only channels defined for that exchange in `src/consts.ts`.
- **IDs** — preserve exchange identifiers without losing precision. Prefer string identifiers when the exchange provides them.
- **Timestamps** — use the exchange event timestamp for `timestamp`. Use `localTimestamp` only when the exchange does not provide a usable event time. Never replace `localTimestamp`; it is the Tardis receive timestamp for replay and streaming.
- **Message roles** — map snapshots, deltas, trades, ticker updates, status messages, and acknowledgements according to the exchange contract. For order book data, make the `isSnapshot` decision from the actual message role, not from the channel name alone.
- **Normalized field semantics** — map a field only when the exchange field has the same meaning as the normalized type. Leave ambiguous fields unmapped until the exchange meaning is verified from docs or captured data.
- **Optional numeric fields** — missing, empty, null, or non-finite exchange values must normalize to `undefined`, not `NaN` or an invalid `Date`. See [EXCHANGE_NUMERIC_FIELDS.md](EXCHANGE_NUMERIC_FIELDS.md) before choosing between `Number`, `asNumberOrUndefined`, and `asNumberIfValid`.
- **Stateful output** — when normalized output is built from multiple partial messages, use the existing state helper patterns and emit only when the normalized value changes.

Normalized type semantics:

- **Trades** — `side` is liquidity taker side: `buy` means the aggressor bought, `sell` means the aggressor sold. Invert maker-side flags when needed. Skip off-book maintenance events such as insurance fund or ADL unless the product contract explicitly requires them. If a trade channel uses `snapshot` followed by `update`, map only `update`; the initial `snapshot` is recent-trade backfill and must have a test that emits nothing to avoid duplicate or stale trades after reconnect. Map trade `snapshot` only when the exchange sends trades exclusively as snapshots and there is no incremental update variant.
- **Book changes** — `book_change` is L2 market-by-price data. `isSnapshot=true` means consumers discard prior book state. `isSnapshot=false` means consumers apply absolute price-level amounts to the current book. `amount=0` removes the level.
- **Book tickers** — `book_ticker` comes from native top-of-book or BBO feeds. It is not `quotes`, which are computed from reconstructed L2 books.
- **Derivative tickers** — keep `lastPrice`, `openInterest`, `indexPrice`, `markPrice`, funding fields, and predicted funding fields aligned with exchange meaning. `fundingTimestamp` is the next funding event timestamp.
- **Liquidations** — `side` is liquidation side: `buy` means a short position was liquidated, `sell` means a long position was liquidated. Do not copy an exchange order side unless it has that meaning.
- **Option summaries** — parse option type, strike, expiration, greeks, IV, underlying, bid/ask, mark, last price, and open interest from the exchange contract. Use instrument metadata when symbol parsing is not reliable.

For `normalizeBookChanges`, first identify where the initial book snapshot comes from:

- Native snapshot plus deltas: map the exchange snapshot as `isSnapshot=true`, then map later deltas as `isSnapshot=false`.
- Snapshot-only feed, such as a full L2 book pushed repeatedly: map each full book message as `isSnapshot=true`.
- Delta feed with a snapshot channel, such as Binance `depthSnapshot` plus `depth`: `getFilters()` must request both channels, buffer deltas until the snapshot arrives, emit one snapshot, then emit deltas.
- Delta-only feed without a snapshot channel: do not mark a delta as a snapshot. Add a snapshot source first or leave the channel out of `normalizeBookChanges`.

Register mapper factory in `src/mappers/index.ts`.

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
- optional, missing, empty, and otherwise invalid values for fields that can be absent

Run tests and validation — see AGENTS.md for the full checklist.

## Decision Points

- **Date-based mapper versioning** — If the exchange changed its API format at some point, you may need different mapper implementations for different time periods. Look at existing examples in `src/mappers/index.ts` for the pattern.
- **Multi-connection feeds** — Some exchanges need multiple WebSocket connections. The base class supports this via `MultiConnectionRealTimeFeedBase`.
- **Decompression** — Some exchanges compress WebSocket messages. Override the decompress hook if needed.
- **Filter optimization** — The base class has `optimizeFilters()` for normalizing subscription filters. Override if the exchange needs special handling.
