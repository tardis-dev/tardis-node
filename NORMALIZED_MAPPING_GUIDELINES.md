# Normalized Mapping Guidelines

Use this when implementing or reviewing `src/mappers/{exchange}.ts`. [ADD_NEW_EXCHANGE.md](ADD_NEW_EXCHANGE.md) owns the workflow; this document owns normalized mapper semantics.

## General Rules

- Map fields only when the exchange field has the same meaning as the normalized type. Leave ambiguous fields unmapped until docs or captured messages confirm the meaning.
- Preserve exchange identifiers without losing precision. Prefer strings when the exchange provides string ids.
- Use the exchange event timestamp for `timestamp`. Use `localTimestamp` only when the exchange does not provide a usable event time. Never replace `localTimestamp`.
- Do not add fallback fields, default values, sequence branches, or type coercion unless official docs, captured messages, or recorder output show that variant.
- If an exchange changes raw API format over time, keep mapper implementations date-based and separate even when Tardis channel names stay the same. Do not mix old and new payload fields in one parser branch unless the same upstream API version documents both variants.
- For numeric parsing, follow [EXCHANGE_NUMERIC_FIELDS.md](EXCHANGE_NUMERIC_FIELDS.md). Missing, empty, null, or non-finite optional values should normalize to `undefined`.
- When normalized output is built from multiple partial messages, use existing state helper patterns and pick one payload type to own the output timestamp. Side-channel updates should update cached state only unless they are intentionally chosen as normalized output sources and their timestamp and field semantics are validated.

## Type Semantics

- **Trades**: `side` is liquidity taker side. `buy` means the aggressor bought; `sell` means the aggressor sold. Invert maker-side flags when needed. If a trade channel sends a recent-trades snapshot followed by updates, map only updates unless the exchange has no incremental trade variant.
- **Book changes**: `book_change` is L2 market-by-price data. `isSnapshot=true` means consumers discard prior book state. `isSnapshot=false` means consumers apply absolute price-level amounts. `amount=0` removes the level.
- **Book tickers**: `book_ticker` comes from native top-of-book or BBO feeds. Do not expose `book_ticker` from a generic ticker just because it contains bid and ask fields unless API metadata and captured payloads show that this is the intended top-of-book product.
- **Derivative tickers**: keep `lastPrice`, `openInterest`, `indexPrice`, `markPrice`, funding fields, and predicted funding fields aligned with exchange meaning. `fundingTimestamp` is the next funding event timestamp. If funding, mark, index, or open interest arrive on different cadences, inspect live or recorded data for stale values and timestamp regressions before deciding which messages should emit.
- **Liquidations**: `side` is liquidation side. `buy` means a short position was liquidated; `sell` means a long position was liquidated. Do not copy an exchange order side unless it has that meaning.
- **Option summaries**: prefer explicit instrument metadata such as `indexAsset` or underlying asset fields over symbol parsing when the exchange provides it.

## Book Snapshot Alignment

First identify where the initial book snapshot comes from:

- Native snapshot plus deltas: map the exchange snapshot as `isSnapshot=true`, then map later deltas as `isSnapshot=false`.
- Snapshot-only feed, such as a full L2 book pushed repeatedly: map each full book message as `isSnapshot=true`.
- Delta feed with a snapshot channel, such as Binance `depthSnapshot` plus `depth`: `getFilters()` must request both channels, buffer deltas until the snapshot arrives, emit one snapshot, then emit deltas.
- Delta-only feed without a snapshot channel: do not mark a delta as a snapshot. Add a snapshot source first or leave the channel out of `normalizeBookChanges`.

For generated or REST-backed snapshots, verify the snapshot shape against recorder output and the exchange docs. Use the deepest documented snapshot level only after checking that the snapshot version still overlaps buffered deltas and does not introduce obvious rate-limit or retry issues. Historical replay should not repeat full sequence validation already performed by recorder; keep client-side logic to the minimal alignment needed to combine the snapshot with later deltas.
