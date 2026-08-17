import { GraphError } from "../errors";
import { currentDigest, currentRuleDigest } from "./digest";
import { isAvailable, predecessors, type GraphState } from "./types";

export type NodeState =
  | "running"
  | "failed"
  | "blocked"
  | "empty"
  | "rejected"
  | "pending"
  | "stale"
  | "fresh";

/**
 * Why a node cannot proceed. "Nothing is there yet", "a person said no" and
 * "nobody has answered yet" are three different facts to put in front of a
 * user, and the interface must not conflate them.
 */
export type BlockedReason = "unavailable-input" | "rejected-input" | "undecided-approval";

/** Why a node's artifact no longer rests on its inputs. */
export type StaleReason = "input-changed" | "rule-changed";

export type NodeEvaluation = {
  readonly state: NodeState;
  readonly blockedReason?: BlockedReason;
  readonly staleReason?: StaleReason;
};

/**
 * The order the overlapping conditions are resolved in. This is part of the
 * definition of the states, not an implementation detail — several of them are
 * true at once for most nodes.
 */
export const STATE_PRECEDENCE: readonly NodeState[] = [
  "running",
  "failed",
  "blocked",
  "empty",
  "rejected",
  "pending",
  "stale",
  "fresh",
];

/**
 * State for one node, computed from the graph. Nothing here is stored: a
 * stored status is a flag that can drift out of agreement with the graph it
 * describes, and computing it removes that whole class of bug.
 */
export function evaluateNode(state: GraphState, nodeId: string): NodeEvaluation {
  const node = state.nodes.get(nodeId);
  if (!node) throw new GraphError("missing-node", `no node ${nodeId}`);

  const run = node.runId === undefined ? undefined : state.runs.get(node.runId);
  if (run?.status === "live") return { state: "running" };
  if (run?.status === "failed") return { state: "failed" };

  const blocked = blockedReason(state, nodeId);
  if (blocked) return { state: "blocked", blockedReason: blocked };

  if (node.artifactId === "") return { state: "empty" };

  const approval = state.approvals.get(nodeId);
  const decided = approval?.artifactId === node.artifactId;
  if (decided && approval?.decision === "reject") return { state: "rejected" };
  if (node.requiresApproval && !decided) return { state: "pending" };

  if (node.inputDigest !== currentDigest(state, nodeId)) {
    return { state: "stale", staleReason: staleReason(state, nodeId) };
  }
  return { state: "fresh" };
}

/**
 * Direct predecessors are enough, and that is the point.
 *
 * Unavailability propagates on its own: if the grandparent has no artifact the
 * parent cannot run, so the parent has no artifact, so this node is blocked. A
 * rejected artifact blocks its whole subtree by the same mechanism. There is
 * no ancestor walk here and there does not need to be one.
 *
 * An earlier draft defined `blocked` as "an ancestor is not fresh", which
 * swallowed `stale` entirely and hid the only signal worth having: a stale
 * parent still holds the artifact its child consumed, so the child is not
 * blocked by it.
 */
function blockedReason(state: GraphState, nodeId: string): BlockedReason | undefined {
  let rejected = false;
  let undecided = false;
  let unavailable = false;

  for (const parentId of predecessors(state, nodeId)) {
    const parent = state.nodes.get(parentId);
    if (!parent) throw new GraphError("missing-node", `no node ${parentId}`);
    if (isAvailable(state, parent)) continue;

    const approval = state.approvals.get(parentId);
    const decided = approval?.artifactId === parent.artifactId;
    if (parent.artifactId !== "" && decided && approval?.decision === "reject") rejected = true;
    else if (parent.artifactId !== "" && parent.requiresApproval) undecided = true;
    else unavailable = true;
  }

  // A definite "no" is the most actionable thing to show, then a decision
  // someone still owes, then the plain absence of an input.
  if (rejected) return "rejected-input";
  if (undecided) return "undecided-approval";
  if (unavailable) return "unavailable-input";
  return undefined;
}

/**
 * Which half of the digest moved. `currentDigest` alone decides *that* a node
 * is stale; this only names it, so the canvas can render a policy change
 * differently from a foundation that moved.
 *
 * When both halves moved this reports `rule-changed`: a policy change is the
 * rarer and more surprising of the two, and losing it in the noise of an
 * ordinary input change is the failure worth avoiding.
 */
function staleReason(state: GraphState, nodeId: string): StaleReason {
  const node = state.nodes.get(nodeId);
  if (!node) throw new GraphError("missing-node", `no node ${nodeId}`);
  return node.ruleDigest === currentRuleDigest(state, nodeId) ? "input-changed" : "rule-changed";
}

export function evaluateNodes(state: GraphState): ReadonlyMap<string, NodeEvaluation> {
  const evaluated = new Map<string, NodeEvaluation>();
  for (const id of state.nodes.keys()) evaluated.set(id, evaluateNode(state, id));
  return evaluated;
}

export function nodeState(state: GraphState, nodeId: string): NodeState {
  return evaluateNode(state, nodeId).state;
}
