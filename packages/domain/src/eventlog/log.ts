import { GraphError } from "../errors";
import { emptyGraph, type GraphState } from "../graph/types";
import { applyEvent, fold, foldUntil } from "./apply";
import type { OrbitalEvent } from "./types";

/** Where to cut a log when forking: at a known event, or at a moment in time. */
export type ForkPoint = { readonly eventId: string } | { readonly at: string };

/**
 * An append-only log and the state it folds to.
 *
 * Immutable: `append` returns a new log. Holding on to an earlier one is how
 * time travel and forking stay honest — no version of the past is mutated by
 * anything that happens later.
 */
export class EventLog {
  readonly graphId: string;
  readonly state: GraphState;
  private readonly entries: readonly OrbitalEvent[];
  private readonly ids: ReadonlySet<string>;

  private constructor(
    graphId: string,
    entries: readonly OrbitalEvent[],
    ids: ReadonlySet<string>,
    state: GraphState,
  ) {
    this.graphId = graphId;
    this.entries = entries;
    this.ids = ids;
    this.state = state;
  }

  static empty(graphId: string): EventLog {
    return new EventLog(graphId, [], new Set(), emptyGraph(graphId));
  }

  static from(graphId: string, events: Iterable<OrbitalEvent>): EventLog {
    return EventLog.empty(graphId).append(...events);
  }

  get events(): readonly OrbitalEvent[] {
    return this.entries;
  }

  append(...events: readonly OrbitalEvent[]): EventLog {
    let state = this.state;
    const entries = [...this.entries];
    const ids = new Set(this.ids);

    for (const event of events) {
      if (ids.has(event.id)) {
        throw new GraphError("duplicate-event", `event ${event.id} is already in the log`);
      }
      state = applyEvent(state, event);
      entries.push(event);
      ids.add(event.id);
    }

    return new EventLog(this.graphId, entries, ids, state);
  }

  /** The graph as it stood at `at`, inclusive. */
  stateAt(at: string): GraphState {
    return foldUntil(this.graphId, this.entries, at);
  }

  /**
   * A new log carrying this one's history up to `point`. Passing a `graphId`
   * rebrands the events, which is what makes the result a branch rather than a
   * copy; event ids are kept, because they identify the same historical facts.
   */
  fork(point: ForkPoint, graphId?: string): EventLog {
    const prefix = this.prefix(point);
    const target = graphId ?? this.graphId;
    const rebranded =
      target === this.graphId ? prefix : prefix.map((event) => ({ ...event, graphId: target }));
    return EventLog.from(target, rebranded);
  }

  private prefix(point: ForkPoint): readonly OrbitalEvent[] {
    if ("at" in point) {
      const at = point.at;
      return this.entries.filter((event) => event.at <= at);
    }
    const index = this.entries.findIndex((event) => event.id === point.eventId);
    if (index === -1) {
      throw new GraphError("unknown-fork-point", `no event ${point.eventId} in this log`);
    }
    return this.entries.slice(0, index + 1);
  }
}

export { fold, foldUntil };
