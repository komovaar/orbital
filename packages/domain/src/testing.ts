import type { OrbitalEvent } from "./eventlog/types";
import { currentDigest, currentRuleDigest } from "./graph/digest";
import {
  emptyGraph,
  type Aperture,
  type Approval,
  type ArtifactKind,
  type Edge,
  type GraphState,
  type NodeKind,
  type OrbitalNode,
  type Run,
} from "./graph/types";

/**
 * Fixtures for building a `GraphState` directly, without going through the
 * event log. Tests for the pure graph functions should not have to know how
 * events are shaped.
 */

export type NodeSpec = {
  readonly id: string;
  readonly kind?: NodeKind;
  readonly title?: string;
  readonly intent?: string;
  readonly requiresApproval?: boolean;
  readonly artifactId?: string;
  readonly artifactKind?: ArtifactKind;
  readonly inputDigest?: string;
  readonly ruleDigest?: string;
  readonly runId?: string;
};

export type EdgeSpec = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly aperture: Aperture;
  readonly selector?: string;
};

export type GraphSpec = {
  readonly graphId?: string;
  readonly nodes: readonly NodeSpec[];
  readonly edges?: readonly EdgeSpec[];
  readonly runs?: readonly Run[];
  readonly approvals?: readonly Approval[];
};

export function buildGraph(spec: GraphSpec): GraphState {
  const graphId = spec.graphId ?? "g";
  const nodes = new Map<string, OrbitalNode>();
  for (const node of spec.nodes) {
    nodes.set(node.id, {
      id: node.id,
      graphId,
      kind: node.kind ?? "derivation",
      intent: node.intent ?? `intent:${node.id}`,
      requiresApproval: node.requiresApproval ?? false,
      artifactId: node.artifactId ?? "",
      inputDigest: node.inputDigest ?? "",
      ruleDigest: node.ruleDigest ?? "",
      ...(node.title === undefined ? {} : { title: node.title }),
      ...(node.artifactKind === undefined ? {} : { artifactKind: node.artifactKind }),
      ...(node.runId === undefined ? {} : { runId: node.runId }),
    });
  }

  const edges = new Map<string, Edge>();
  for (const edge of spec.edges ?? []) {
    edges.set(edge.id, {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      aperture: edge.aperture,
      ...(edge.selector === undefined ? {} : { selector: edge.selector }),
    });
  }

  return {
    ...emptyGraph(graphId),
    nodes,
    edges,
    runs: new Map((spec.runs ?? []).map((run) => [run.id, run])),
    approvals: new Map((spec.approvals ?? []).map((approval) => [approval.nodeId, approval])),
  };
}

/**
 * Record an artifact against the node's inputs as they stand — what an
 * executor does when a run produces one. The node comes out `fresh`, unless it
 * requires approval, in which case `pending`.
 */
export function withArtifact(
  state: GraphState,
  nodeId: string,
  artifactId: string,
  artifactKind: ArtifactKind = "document",
): GraphState {
  const node = state.nodes.get(nodeId);
  if (!node) throw new Error(`no node ${nodeId}`);
  const nodes = new Map(state.nodes);
  nodes.set(nodeId, {
    ...node,
    artifactId,
    artifactKind,
    inputDigest: currentDigest(state, nodeId),
    ruleDigest: currentRuleDigest(state, nodeId),
  });
  return { ...state, nodes };
}

export function withIntent(state: GraphState, nodeId: string, intent: string): GraphState {
  const node = state.nodes.get(nodeId);
  if (!node) throw new Error(`no node ${nodeId}`);
  const nodes = new Map(state.nodes);
  nodes.set(nodeId, { ...node, intent });
  return { ...state, nodes };
}

export function withApproval(
  state: GraphState,
  nodeId: string,
  decision: "approve" | "reject",
): GraphState {
  const node = state.nodes.get(nodeId);
  if (!node) throw new Error(`no node ${nodeId}`);
  const approvals = new Map(state.approvals);
  approvals.set(nodeId, {
    nodeId,
    artifactId: node.artifactId,
    decision,
    actor: "me",
    at: "2026-01-01T00:00:00Z",
  });
  return { ...state, approvals };
}

/** A run in the given status, attached to the node as its current one. */
export function withRun(
  state: GraphState,
  nodeId: string,
  runId: string,
  status: Run["status"],
): GraphState {
  const node = state.nodes.get(nodeId);
  if (!node) throw new Error(`no node ${nodeId}`);
  const runs = new Map(state.runs);
  runs.set(runId, {
    id: runId,
    nodeId,
    status,
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  const nodes = new Map(state.nodes);
  nodes.set(nodeId, { ...node, runId });
  return { ...state, nodes, runs };
}

type EventOf<K extends OrbitalEvent["kind"]> = Extract<OrbitalEvent, { kind: K }>;

/**
 * Build one event, filling in the envelope. Ids and timestamps default to a
 * monotonic counter so a test only has to state the fields it cares about;
 * pass them explicitly when the test is about ordering.
 */
export function ev<K extends OrbitalEvent["kind"]>(
  kind: K,
  nodeId: string,
  payload: EventOf<K>["payload"],
  overrides: { id?: string; graphId?: string; actor?: string; at?: string } = {},
): EventOf<K> {
  ev.seq += 1;
  const envelope = {
    id: overrides.id ?? `ev${ev.seq}`,
    graphId: overrides.graphId ?? "g",
    nodeId,
    kind,
    actor: overrides.actor ?? "me",
    at: overrides.at ?? `2026-01-01T00:00:${String(ev.seq).padStart(2, "0")}Z`,
    payload,
  };
  return envelope as unknown as EventOf<K>;
}
ev.seq = 0;
