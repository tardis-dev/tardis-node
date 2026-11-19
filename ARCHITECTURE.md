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
  │                         Cache to disk (.gz/.zst file)
  │  ←── message (sliceKey, path, size) ──
  │                         Fetch next slice...
  │                                     │
  Read cached file from disk            │
  Decompress (gzip/zstd)                │
  Split by newlines into batches        │
  Parse JSON messages                   │
  Yield {localTimestamp, message}       │
```

Worker thread pre-fetches and caches slices while the main thread processes the current one. This keeps I/O and CPU pipelined. Normal replay fetches the first and last minute as one-minute requests, uses the returned suggested slice size for the middle of the range, and caches multi-minute responses as start-minute files with a `.size-{minutes}` suffix. One-minute cache paths keep the legacy filename. Zstandard responses always use the standard `.zst` suffix. Replay negotiates compression through `Accept-Encoding` and streams all concatenated Zstandard frames through Node.js's native decoder, rejecting truncated or invalid data.

`replay()` decodes one line batch at a time and still yields individual public messages in order. `replayNormalized()` consumes the same internal line batches directly, avoiding an intermediate per-message raw iterator while keeping mapper invocation lazy. This preserves async-iterator backpressure for built-in and custom normalizers while the stream's high-water mark keeps splitter read-ahead small.

## Real-time Streaming

`RealTimeFeedBase` manages WebSocket connections to exchanges. Handles connection lifecycle (connect, subscribe, validate, reconnect on failure). Exchange-specific feeds extend the base class with subscription formats and message handling. Breaking real-time iteration or calling its standard `return()` closes the underlying feeds before finishing iterator cleanup, including quiet feeds whose `next()` is still pending.

`MultiConnectionRealTimeFeedBase` merges several connections and REST pollers of one exchange. A disconnect resets all normalized state, so when any connection drops, the feed closes all its connections and pollers, yields one disconnect and opens them again after the retry delay of the failed connection.

## Mapper System

Mappers transform raw exchange messages into normalized types (trades, book changes, tickers, liquidations, etc.). Each exchange defines its mapper registry next to its mapper classes in `src/mappers/{exchange}.ts`; `src/mappers/index.ts` aggregates those registries for the public normalizers.

Some exchanges have date-based mapper versioning through `mapper()` entries — different mapper implementations for different time periods when the exchange changed its API format.

## Key Abstractions

- **`combine()`** — Merges multiple async iterables into one. Historical streams are ordered by local timestamp. Real-time inputs must all be managed Tardis iterators from `stream()` or `streamNormalized()`, optionally passed through `compute()` or `combine()`; they are emitted as they arrive. Do not mix historical and real-time inputs.
- **`compute()`** — Wraps an async iterable and produces derived data (book snapshots, trade bars) via computables.
- **`OrderBook`** — Full limit order book reconstruction from incremental updates, using sorted price-level pages for efficient lookup, updates, and top-of-book iteration.

## Configuration

Exchange definitions and channel info in `src/consts.ts`. Mapper registries live in each exchange mapper file and are aggregated by `src/mappers/index.ts`; feed registrations live in `src/realtimefeeds/index.ts`.
