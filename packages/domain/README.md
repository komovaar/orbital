# @orbital/domain

The Orbital domain layer: the graph model and the event log.

This package is pure. It has no filesystem, network or process access, and it
holds no state of its own — every value it produces is a function of the events
it is given. Scheduling, execution, context assembly, the API and persistence
live outside it and are not implemented yet.

Purity is structural here rather than a convention: nothing this package
depends on can do I/O, so an executor import will not compile. The lint rule in
`eslint.config.js` is a second layer, not the only one.

See [.plans/orbital-architecture.md](../../.plans/orbital-architecture.md) for
the target design and [.plans/orbital-plan.md](../../.plans/orbital-plan.md)
for the order of work.

## Layout

| Path | What it is |
|---|---|
| `src/graph` | nodes, edges, apertures, input digest, computed state, validity |
| `src/eventlog` | events, fold, fold-to-timestamp, fork |
| `src/testing.ts` | fixtures — graph builders and an event builder |

## The two things worth knowing before reading the code

**State is computed, never stored.** `evaluateNode` derives one of eight states
from the graph every time it is asked. There is no status field to drift out of
agreement with the graph it describes.

**Staleness moves one hop.** A stale parent still holds the artifact its child
consumed, so it does not stale the child and does not block it. The frontier is
the signal; a cone of colour below every change is not.

## Commands

```
npm test
npm run lint
npm run typecheck
```
