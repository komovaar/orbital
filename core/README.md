# core

The Orbital domain layer: the graph model and the event log.

This package is pure. It has no filesystem, network or process access, and it
holds no state of its own — every value it produces is a function of the events
it is given. Scheduling, execution, context assembly, the API and persistence
live outside it and are not implemented yet.

See [.plans/orbital-architecture.md](../.plans/orbital-architecture.md) for the
target design and [.plans/orbital-plan.md](../.plans/orbital-plan.md) for the
order of work.

## Layout

| Path | What it is |
|---|---|
| `src/graph` | nodes, edges, apertures, input digest, computed state, validity |
| `src/eventlog` | events, fold, fold-to-timestamp, fork |

## Commands

```
npm test
npm run lint
npm run typecheck
```
