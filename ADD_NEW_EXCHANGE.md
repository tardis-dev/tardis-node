# Adding a New Exchange

## Overview

Adding an exchange to tardis-node requires three things: mappers (transform raw exchange messages into normalized types), a real-time feed (WebSocket connection), and constant definitions.

## Workflow

### 1. Add exchange constants

In `src/consts.ts`:

- Add exchange ID to the exchanges array
- Add channel info (list of available channels for the exchange)

### 2. Create mappers

Create `src/mappers/{exchange}.ts`. Each mapper class implements the Mapper interface — look at existing mapper implementations to find an exchange with a similar message format.

Mappers to implement depend on what the exchange provides: trades, book changes, tickers, derivative tickers, liquidations, book tickers, etc.

Register mapper factory in `src/mappers/index.ts`.

### 3. Create real-time feed

Create `src/realtimefeeds/{exchange}.ts`. Extend `RealTimeFeedBase` with:

- WebSocket URL
- Subscription message format
- Any exchange-specific hooks (decompression, heartbeat handling, error filtering)

Register in `src/realtimefeeds/index.ts`.

### 4. Test

Run tests and validation — see AGENTS.md for the full checklist.

## Decision Points

- **Date-based mapper versioning** — If the exchange changed its API format at some point, you may need different mapper implementations for different time periods. Look at existing examples in `src/mappers/index.ts` for the pattern.
- **Multi-connection feeds** — Some exchanges need multiple WebSocket connections. The base class supports this via `MultiConnectionRealTimeFeedBase`.
- **Decompression** — Some exchanges compress WebSocket messages. Override the decompress hook if needed.
- **Filter optimization** — The base class has `optimizeFilters()` for normalizing subscription filters. Override if the exchange needs special handling.
