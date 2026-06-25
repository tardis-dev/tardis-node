# tardis-node

Public npm package (`tardis-dev`). Provides async iterator API for historical replay and real-time streaming of cryptocurrency market data, with exchange-specific mappers for normalization.

## Build & Test

```bash
npm run build        # tsc
npm test             # build + jest
npm run check-format # prettier check
```

## Editing Rules

- Keep backward compatibility for public API signatures — this is a published npm package
- Maintain cache key stability (filters are normalized/sorted intentionally)
- Preserve memory-safe streaming behavior (avoid large in-memory buffering)
- Exchange additions must update realtime feed + mapper registries consistently
- New exchange support and behavior-changing mapper or realtime feed changes must follow the evidence checklist in [ADD_NEW_EXCHANGE.md](ADD_NEW_EXCHANGE.md); mapper snapshots alone are not enough for new exchange support
- Run the repo formatter/check-format before handoff and before staging, committing, or opening a PR.

## Validation

- `npm run build && npm test`
- `npm run check-format`
- Manual `replay()` / `replayNormalized()` checks must run from a real `.mjs`/`.js` file, not from `node --input-type=module` or STDIN. Replay uses worker threads, and workers inherit `execArgv`; `--input-type` makes Node reject the worker file with `ERR_INPUT_TYPE_NOT_ALLOWED`.

## Operational Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — async iterators, replay pipeline, mapper system, order book
- [ADD_NEW_EXCHANGE.md](ADD_NEW_EXCHANGE.md) — add mappers and realtime feed for a new exchange
- [NORMALIZED_MAPPING_GUIDELINES.md](NORMALIZED_MAPPING_GUIDELINES.md) — normalized mapper semantics and snapshot alignment rules

## Publishing

Published via GitHub Actions (`publish.yaml`). Do not publish manually unless explicitly requested.

## Keeping Docs Current

When you change code, check if any docs in this repo become stale as a result — if so, update them. When following a workflow doc, if the steps don't match reality, fix the doc so the next run is better.
