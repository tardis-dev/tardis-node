# Adding a New Exchange

## Overview

Adding an exchange to tardis-node requires three things: mappers (transform raw exchange messages into normalized types), a real-time feed (WebSocket connection), and constant definitions.

## Workflow

### 1. Add exchange constants

In `src/consts.ts`:

- Add exchange ID to the exchanges array
- Add channel info for the native channels exposed through Tardis API filters

### 2. Create mappers

Create `src/mappers/{exchange}.ts`. Each mapper class implements the Mapper interface — look at existing mapper implementations to find an exchange with a similar message format.

Before coding, make a coverage table from the exchange docs and captured WebSocket messages. For each channel and message variant, record the message role and whether it is normalized, ignored, or only used for state. Do not infer the role from the channel name alone; exchanges use different conventions for snapshots, deltas, events, subscription acknowledgements, cached payloads, and status messages.

Use this shape in the PR description or implementation notes:

| Channel | Message variants | Role | Normalized output | Decision |
| ------- | ---------------- | ---- | ----------------- | -------- |
|         |                  |      |                   |          |

Mappers to implement depend on what the exchange provides: trades, book changes, tickers, derivative tickers, liquidations, book tickers, options summaries, etc. Do not stop at the channel list — inspect the fields each channel carries and map every supported normalized type. For example, a native ticker channel may produce `BookTicker`, while market stats may produce `DerivativeTicker`.

Mapper decisions to make explicit:

- **Symbols** — use the same exchange symbol value across mapper output, replay filters, real-time subscription filters, and customer-facing filters. If the exchange exposes more than one identifier, choose the identifier used by the Tardis API feed contract and keep conversions explicit.
- **Filters** — implement `getFilters()` for each mapper to request the native channels needed by that normalizer in `replayNormalized()` and `streamNormalized()`. Return only channels defined for that exchange.
- **IDs** — preserve exchange identifiers without losing precision. Prefer string identifiers when the exchange provides them.
- **Message roles** — map snapshots, deltas, trades, ticker updates, status messages, and acknowledgements according to the exchange contract. For order book data, make the `isSnapshot` decision from the actual message role, not from the channel name alone.
- **Normalized field semantics** — map a field only when the exchange field has the same meaning as the normalized type. Leave ambiguous fields unmapped until the exchange meaning is verified from docs or captured data.
- **Optional numeric fields** — missing, empty, null, or non-finite exchange values must normalize to `undefined`, not `NaN` or an invalid `Date`.
- **Stateful output** — when normalized output is built from multiple partial messages, use the existing state helper patterns and emit only when the normalized value changes.

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
