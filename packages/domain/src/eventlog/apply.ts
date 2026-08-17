import { GraphError } from "../errors";
import { validateEdgeAddition } from "../graph/validate";
import {
  emptyGraph,
  type Approval,
  type Edge,
  type GraphState,
  type OrbitalNode,
  type Run,
  type RunStatus,
} from "../graph/types";
import type { OrbitalEvent } from "./types";

/**
 * Apply one event. Pure: it returns a new state and never mutates the old one,
 * so any prefix of a log can be re-folded at any time.
 *
 * Invalid mutations are rejected here rather than recorded and discovered
 * later by whatever trips over them first.
 */
export function applyEvent(state: GraphState, event: OrbitalEvent): GraphState {
  if (event.graphId !== state.graphId) {
    throw new GraphError(
      "wrong-graph",
      `event ${event.id} belongs to ${event.graphId}, not ${state.graphId}`,
    );
  }

  switch (event.kind) {
    case "NodeCreated": {
      if (state.nodes.has(event.nodeId)) {
        throw new GraphError("duplicate-node", `node ${event.nodeId} already exists`);
      }
      return putNode(state, {
        id: event.nodeId,
        graphId: state.graphId,
        kind: event.payload.nodeKind,
        intent: event.payload.intent,
        requiresApproval: event.payload.requiresApproval ?? false,
        artifactId: "",
        inputDigest: "",
        ruleDigest: "",
        ...(event.payload.title === undefined ? {} : { title: event.payload.title }),
      });
    }

    case "IntentChanged": {
      const node = requireNode(state, event.nodeId);
      return putNode(state, {
        ...node,
        intent: event.payload.intent,
        ...(event.payload.title === undefined ? {} : { title: event.payload.title }),
      });
    }

    case "NodeDeleted": {
      requireNode(state, event.nodeId);
      const nodes = new Map(state.nodes);
      nodes.delete(event.nodeId);
      const edges = new Map(state.edges);
      for (const [id, edge] of state.edges) {
        if (edge.from === event.nodeId || edge.to === event.nodeId) edges.delete(id);
      }
      const runs = new Map(state.runs);
      for (const [id, run] of state.runs) if (run.nodeId === event.nodeId) runs.delete(id);
      const approvals = new Map(state.approvals);
      approvals.delete(event.nodeId);
      return { ...state, nodes, edges, runs, approvals };
    }

    case "EdgeAdded": {
      requireNode(state, event.nodeId);
      if (event.nodeId !== event.payload.to) {
        throw new GraphError(
          "misaddressed-event",
          `edge event ${event.id} is addressed to ${event.nodeId} but the edge ends at ${event.payload.to}`,
        );
      }
      const edge: Edge = {
        id: event.payload.edgeId,
        from: event.payload.from,
        to: event.payload.to,
        aperture: event.payload.aperture,
        ...(event.payload.selector === undefined ? {} : { selector: event.payload.selector }),
      };
      validateEdgeAddition(state, edge);
      const edges = new Map(state.edges);
      edges.set(edge.id, edge);
      return { ...state, edges };
    }

    case "EdgeRemoved": {
      const edge = state.edges.get(event.payload.edgeId);
      if (!edge) throw new GraphError("missing-edge", `no edge ${event.payload.edgeId}`);
      if (edge.to !== event.nodeId) {
        throw new GraphError(
          "misaddressed-event",
          `edge event ${event.id} is addressed to ${event.nodeId} but the edge ends at ${edge.to}`,
        );
      }
      const edges = new Map(state.edges);
      edges.delete(edge.id);
      return { ...state, edges };
    }

    case "RunStarted": {
      const node = requireNode(state, event.nodeId);
      if (state.runs.has(event.payload.runId)) {
        throw new GraphError("invalid-payload", `run ${event.payload.runId} already exists`);
      }
      const runs = new Map(state.runs);
      // The previous run is superseded, not ended: it keeps its history, but
      // nothing is executing in it any more.
      const previous = node.runId === undefined ? undefined : runs.get(node.runId);
      if (previous?.status === "live") {
        runs.set(previous.id, { ...previous, status: "idle", updatedAt: event.at });
      }
      runs.set(event.payload.runId, {
        id: event.payload.runId,
        nodeId: node.id,
        status: "live",
        startedAt: event.at,
        updatedAt: event.at,
        ...(event.payload.sessionId === undefined ? {} : { sessionId: event.payload.sessionId }),
      });
      return putNode({ ...state, runs }, { ...node, runId: event.payload.runId });
    }

    case "MessageSent":
      return putRun(state, event.payload.runId, event.nodeId, event.at, { status: "live" });

    case "RunProgressed":
      return putRun(state, event.payload.runId, event.nodeId, event.at, {
        status: "live",
        ...(event.payload.sessionId === undefined ? {} : { sessionId: event.payload.sessionId }),
      });

    case "RunFailed":
      return putRun(state, event.payload.runId, event.nodeId, event.at, { status: "failed" });

    case "ArtifactProduced": {
      const node = requireNode(state, event.nodeId);
      if (event.payload.artifactId === "") {
        throw new GraphError("invalid-payload", `event ${event.id} produced an empty artifact id`);
      }
      // The run goes idle rather than ending: the session is still there to
      // continue, and a run may produce several artifacts.
      const withRun =
        event.payload.runId === undefined
          ? state
          : putRun(state, event.payload.runId, event.nodeId, event.at, { status: "idle" });
      return putNode(withRun, {
        ...node,
        artifactId: event.payload.artifactId,
        artifactKind: event.payload.artifactKind,
        inputDigest: event.payload.inputDigest,
        ruleDigest: event.payload.ruleDigest,
        ...(event.payload.runId === undefined ? {} : { runId: event.payload.runId }),
      });
    }

    case "ApprovalDecided": {
      const node = requireNode(state, event.nodeId);
      if (!node.requiresApproval) {
        throw new GraphError("invalid-payload", `node ${node.id} does not require approval`);
      }
      if (node.artifactId === "" || node.artifactId !== event.payload.artifactId) {
        throw new GraphError(
          "invalid-payload",
          `event ${event.id} decides on artifact ${event.payload.artifactId}, but ${node.id} holds ${node.artifactId || "none"}`,
        );
      }
      const approval: Approval = {
        nodeId: node.id,
        artifactId: event.payload.artifactId,
        decision: event.payload.decision,
        actor: event.actor,
        at: event.at,
      };
      const approvals = new Map(state.approvals);
      approvals.set(node.id, approval);
      return { ...state, approvals };
    }
  }
}

export function fold(graphId: string, events: Iterable<OrbitalEvent>): GraphState {
  let state = emptyGraph(graphId);
  for (const event of events) state = applyEvent(state, event);
  return state;
}

/**
 * The state as of a moment. This is the whole of the time scrubber: no
 * separate machinery, just a shorter prefix.
 *
 * Timestamps must be ISO 8601 in the same zone, so that string order is
 * chronological order.
 */
export function foldUntil(
  graphId: string,
  events: Iterable<OrbitalEvent>,
  until: string,
): GraphState {
  return fold(
    graphId,
    [...events].filter((event) => event.at <= until),
  );
}

function requireNode(state: GraphState, nodeId: string): OrbitalNode {
  const node = state.nodes.get(nodeId);
  if (!node) throw new GraphError("missing-node", `no node ${nodeId}`);
  return node;
}

function putNode(state: GraphState, node: OrbitalNode): GraphState {
  const nodes = new Map(state.nodes);
  nodes.set(node.id, node);
  return { ...state, nodes };
}

function putRun(
  state: GraphState,
  runId: string,
  nodeId: string,
  at: string,
  change: { readonly status: RunStatus; readonly sessionId?: string },
): GraphState {
  const run = state.runs.get(runId);
  if (!run) throw new GraphError("invalid-payload", `no run ${runId}`);
  if (run.nodeId !== nodeId) {
    throw new GraphError("misaddressed-event", `run ${runId} belongs to ${run.nodeId}`);
  }
  const next: Run = { ...run, ...change, updatedAt: at };
  const runs = new Map(state.runs);
  runs.set(runId, next);
  return { ...state, runs };
}
