# Architecture

tardis-node provides a unified async iterator API for consuming cryptocurrency market data. Two primary modes: **replay** (historical) and **stream** (real-time), both sharing the same normalized data types and mapper infrastructure.

## Core Design

Every data source produces an `AsyncIterableIterator`. This applies uniformly to raw replay, raw streaming, normalized replay, normalized streaming, combined streams, and computed/derived data.

## Replay Pipeline

```
Main Thread                         Worker Thread
  │                                     │
  │── Start replay ──→                  │
  │                         Fetch data slice from API
  │                         Cache to disk (.gz file)
  │  ←── message (sliceKey, path) ──    │
  │                         Fetch next slice...
  │                                     │
  Read cached file from disk            │
  Decompress (gunzip)                   │
  Split by newlines                     │
  Parse JSON messages                   │
  Yield {localTimestamp, message}       │
```

Worker thread pre-fetches and caches slices while the main thread processes the current one. This keeps I/O and CPU pipelined.

## Real-time Streaming

`RealTimeFeedBase` manages WebSocket connections to exchanges. Handles connection lifecycle (connect, subscribe, validate, reconnect on failure). Exchange-specific feeds extend the base class with subscription formats and message handling.

## Mapper System

Mappers transform raw exchange messages into normalized types (trades, book changes, tickers, liquidations, etc.). Each exchange has mapper classes registered in `src/mappers/index.ts`.

Some exchanges have date-based mapper versioning — different mapper implementations for different time periods when the exchange changed its API format.

## Key Abstractions

- **`combine()`** — Merges multiple async iterables into one, ordered by timestamp. Enables cross-exchange data feeds.
- **`compute()`** — Wraps an async iterable and produces derived data (book snapshots, trade bars) via computables.
- **`OrderBook`** — Full limit order book reconstruction from incremental updates, using a Red-Black Tree for efficient price level management.

## Configuration

Exchange definitions and channel info in `src/consts.ts`. Mapper and feed registrations in their respective `index.ts` files.
