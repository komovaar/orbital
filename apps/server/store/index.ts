import type { GraphState, OrbitalEvent } from "@orbital/domain";

/** An event as the log holds it. `seq` is the log order, which is authoritative. */
export type StoredEvent = OrbitalEvent & { readonly seq: number };

export type NodePosition = {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
};

/**
 * A group is a collapsible box over member nodes and nothing else. It has no
 * intent, no artifact and no digest, so it is view state — edges always
 * connect real nodes.
 */
export type Group = {
  readonly groupId: string;
  readonly title: string;
  readonly collapsed: boolean;
  readonly members: readonly string[];
};

export type ViewState = {
  readonly positions: readonly NodePosition[];
  readonly groups: readonly Group[];
};

export interface Store {
  /**
   * Validate and append. Events are checked by applying them to the current
   * state, so an invalid mutation is rejected here rather than written and
   * discovered later by whatever trips over it first. All or nothing.
   */
  append(graphId: string, events: readonly OrbitalEvent[]): readonly StoredEvent[];

  /** The log for a graph, in log order, optionally only what is newer than `sinceSeq`. */
  events(graphId: string, sinceSeq?: number): readonly StoredEvent[];

  /** The fold. Uses a snapshot when there is one, and is identical either way. */
  state(graphId: string): GraphState;

  graphIds(): readonly string[];

  view(graphId: string): ViewState;
  setPosition(graphId: string, position: NodePosition): void;
  clearPosition(graphId: string, nodeId: string): void;
  putGroup(graphId: string, group: Group): void;
  deleteGroup(graphId: string, groupId: string): void;

  /** Every successful append, for the subscription to fan out. */
  subscribe(listener: (events: readonly StoredEvent[]) => void): () => void;

  close(): void;
}

export { SqliteStore } from "./sqlite.ts";
export { decodeState, encodeState } from "./snapshot.ts";
