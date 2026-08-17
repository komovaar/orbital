import type { Approval, Edge, GraphState, OrbitalNode, Run } from "@orbital/domain";

/**
 * A snapshot is a fold, written down. `GraphState` holds Maps, which JSON has
 * no opinion about, so they travel as arrays and are rebuilt on the way back.
 *
 * Nothing here interprets the values. If the shape of a node changes, old
 * snapshots become wrong — which is why `SNAPSHOT_VERSION` exists and why a
 * mismatch discards rather than migrates. Snapshots are a cache; the log is
 * the truth, and re-folding is always correct.
 */
export const SNAPSHOT_VERSION = 1;

type Encoded = {
  readonly version: number;
  readonly graphId: string;
  readonly nodes: readonly OrbitalNode[];
  readonly edges: readonly Edge[];
  readonly runs: readonly Run[];
  readonly approvals: readonly Approval[];
};

export function encodeState(state: GraphState): string {
  const encoded: Encoded = {
    version: SNAPSHOT_VERSION,
    graphId: state.graphId,
    nodes: [...state.nodes.values()],
    edges: [...state.edges.values()],
    runs: [...state.runs.values()],
    approvals: [...state.approvals.values()],
  };
  return JSON.stringify(encoded);
}

/** Returns undefined for anything this build cannot read, rather than guessing. */
export function decodeState(json: string): GraphState | undefined {
  let encoded: Encoded;
  try {
    encoded = JSON.parse(json) as Encoded;
  } catch {
    return undefined;
  }
  if (encoded?.version !== SNAPSHOT_VERSION) return undefined;

  return {
    graphId: encoded.graphId,
    nodes: new Map(encoded.nodes.map((node) => [node.id, node])),
    edges: new Map(encoded.edges.map((edge) => [edge.id, edge])),
    runs: new Map(encoded.runs.map((run) => [run.id, run])),
    approvals: new Map(encoded.approvals.map((approval) => [approval.nodeId, approval])),
  };
}
