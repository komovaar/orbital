/**
 * The graph model. A node is a derivation: intent + inputs -> artifact. It is
 * not an agent.
 *
 * Two kinds that earlier drafts had are deliberately absent. `gate` is a flag
 * (`requiresApproval`) rather than a kind: an unapproved artifact is not
 * available to consumers, so the subtree below blocks through the ordinary
 * rule and no second node has to exist to express a boolean. `group` is a view
 * — it has no intent, artifact or digest, so it has nothing to be in here.
 */
export type NodeKind = "source" | "derivation" | "watcher";

/**
 * How an artifact inlines into a consumer's context. Not decoration: a patch,
 * a plan document, a run summary and a human decision each read differently,
 * and the per-edge budget breakdown cannot be computed without knowing which
 * one an edge carries.
 *
 * Repositories are not here. They are never inlined, only referenced.
 */
export type ArtifactKind = "patch" | "document" | "summary" | "decision";

export type OrbitalNode = {
  readonly id: string;
  readonly graphId: string;
  readonly kind: NodeKind;
  /** Short, for the card. Optional, but extraction already produces one. */
  readonly title?: string;
  readonly intent: string;
  /** A gate: consumers see this node's artifact only once it is approved. */
  readonly requiresApproval: boolean;
  /** Reference into the artifact store, never the content itself. "" = none. */
  readonly artifactId: string;
  readonly artifactKind?: ArtifactKind;
  /** The digest of the inputs at the moment the artifact was computed. */
  readonly inputDigest: string;
  /**
   * The inherited-normative half of `inputDigest`, recorded separately so a
   * stale node can say *why*: rules moved, or the foundation did. Carried in
   * the event payload for the same reason `inputDigest` is — see `eventlog`.
   */
  readonly ruleDigest: string;
  /** The most recent run. Superseded by the next one on the same node. */
  readonly runId?: string;
};

/**
 * What an edge grants the consumer. An edge declares context visibility, never
 * execution order — order is derived from the dependencies themselves. There
 * is no `then` edge and there will not be one.
 */
export type Aperture = "artifact" | "reference" | "normative";

export type Edge = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly aperture: Aperture;
  /** Which slice of the source artifact the consumer sees. */
  readonly selector?: string;
};

/**
 * A run is a session, not an attempt: one session id, many process
 * invocations, potentially many artifacts.
 *
 * `live` means a process is alive right now — which is what makes a node
 * `running`. `idle` means the session exists and can be continued but nothing
 * is executing; a session that is merely idle is not finished, which is why
 * there is no "succeeded" here and no event that ends a run except failure.
 */
export type RunStatus = "live" | "idle" | "failed";

export type Run = {
  readonly id: string;
  readonly nodeId: string;
  readonly status: RunStatus;
  /** The executor's session handle, for Continue. */
  readonly sessionId?: string;
  readonly startedAt: string;
  readonly updatedAt: string;
};

/**
 * A person's ruling on a node's artifact. Rejection is not the same as
 * silence: an undecided artifact is `pending`, a rejected one has been
 * answered, and the interface must not conflate them.
 *
 * The decision names the artifact it was made against, so producing a new
 * artifact returns the node to undecided without needing an event to say so.
 */
export type Approval = {
  readonly nodeId: string;
  readonly artifactId: string;
  readonly decision: "approve" | "reject";
  readonly actor: string;
  readonly at: string;
};

/**
 * The fold of an event log. Node state is deliberately absent: it is computed
 * from this structure, never stored.
 *
 * Group membership and canvas positions are absent too. They are view state
 * and belong in a store beside the log — the log records what the graph means,
 * not how it was arranged on a screen.
 */
export type GraphState = {
  readonly graphId: string;
  readonly nodes: ReadonlyMap<string, OrbitalNode>;
  readonly edges: ReadonlyMap<string, Edge>;
  readonly runs: ReadonlyMap<string, Run>;
  /** Keyed by node id: one standing decision per node. */
  readonly approvals: ReadonlyMap<string, Approval>;
};

export function emptyGraph(graphId: string): GraphState {
  return {
    graphId,
    nodes: new Map(),
    edges: new Map(),
    runs: new Map(),
    approvals: new Map(),
  };
}

/** Edges pointing at `nodeId`, in the stable order the digest depends on. */
export function incomingEdges(state: GraphState, nodeId: string): readonly Edge[] {
  return [...state.edges.values()].filter((edge) => edge.to === nodeId).sort(compareEdges);
}

export function outgoingEdges(state: GraphState, nodeId: string): readonly Edge[] {
  return [...state.edges.values()].filter((edge) => edge.from === nodeId).sort(compareEdges);
}

/** Direct dependencies of `nodeId`, deduplicated, in stable order. */
export function predecessors(state: GraphState, nodeId: string): readonly string[] {
  return [...new Set(incomingEdges(state, nodeId).map((edge) => edge.from))].sort();
}

export function compareEdges(a: Edge, b: Edge): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Whether a node's artifact is available to its consumers — it exists, and
 * where approval is required it has been granted.
 *
 * This one predicate is the whole of the gate mechanism. Nothing downstream
 * needs to know that approval exists.
 */
export function isAvailable(state: GraphState, node: OrbitalNode): boolean {
  if (node.artifactId === "") return false;
  if (!node.requiresApproval) return true;
  const approval = state.approvals.get(node.id);
  return approval?.artifactId === node.artifactId && approval.decision === "approve";
}
