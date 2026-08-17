import { GraphError } from "../errors";
import { hash } from "../hash";
import { compareEdges, incomingEdges, predecessors, type Edge, type GraphState } from "./types";

/**
 * What an edge feeds into the consumer's digest.
 *
 * `artifact` and `normative` both pin the source's content, so re-running the
 * source makes the consumer stale. `reference` deliberately contributes
 * nothing: it hands over live access rather than a snapshot, so the consumer's
 * freshness cannot be a function of content it never inlined. Adding or
 * removing a reference edge still moves the digest, because the edge's own
 * identity is part of it.
 */
export function edgeContribution(state: GraphState, edge: Edge): string {
  if (edge.aperture === "reference") return "";
  const source = state.nodes.get(edge.from);
  if (!source) {
    throw new GraphError("missing-node", `edge ${edge.id} reads from unknown node ${edge.from}`);
  }
  return source.artifactId;
}

/**
 * Normative rules reaching a node: those aimed at it directly, plus every rule
 * that applies to any ancestor. A rule governs its target and the whole
 * subtree below it, so it has to travel down through edges of every aperture.
 * Deduplicated by edge id, so a rule arriving over two paths counts once.
 */
export function normativeClosure(state: GraphState, nodeId: string): readonly Edge[] {
  const memo = new Map<string, readonly Edge[]>();
  const visiting = new Set<string>();

  const walk = (id: string): readonly Edge[] => {
    const cached = memo.get(id);
    if (cached) return cached;
    if (visiting.has(id)) {
      throw new GraphError("cycle", `cycle through ${id} while collecting normative rules`);
    }
    visiting.add(id);

    const found = new Map<string, Edge>();
    for (const edge of incomingEdges(state, id)) {
      if (edge.aperture === "normative") found.set(edge.id, edge);
      for (const inherited of walk(edge.from)) found.set(inherited.id, inherited);
    }

    visiting.delete(id);
    const result = [...found.values()].sort(compareEdges);
    memo.set(id, result);
    return result;
  };

  return walk(nodeId);
}

/** Normative rules a node inherits from its ancestors rather than owning directly. */
export function inheritedNormative(state: GraphState, nodeId: string): readonly Edge[] {
  const direct = new Set(incomingEdges(state, nodeId).map((edge) => edge.id));
  const inherited = new Map<string, Edge>();
  for (const predecessor of predecessors(state, nodeId)) {
    for (const edge of normativeClosure(state, predecessor)) {
      if (!direct.has(edge.id)) inherited.set(edge.id, edge);
    }
  }
  return [...inherited.values()].sort(compareEdges);
}

function part(prefix: string, state: GraphState, edge: Edge): readonly string[] {
  return [prefix, edge.id, edge.aperture, edge.selector ?? "", edgeContribution(state, edge)];
}

/**
 * digest(node) = H(intent,
 *                  for each incoming edge in stable order:
 *                      (edge.id, aperture, selector, contribution(edge)),
 *                  for each inherited normative rule in stable order:
 *                      (edge.id, aperture, selector, contribution(edge)))
 *
 * Inherited rules are folded in because a rule that applies from three levels
 * up is as much an input as a direct one. Leaving them out would make
 * `inputDigest` lie about what was consumed, which is the one thing it must
 * never do.
 *
 * Freshness is a function of this and nothing else.
 */
export function currentDigest(state: GraphState, nodeId: string): string {
  const node = state.nodes.get(nodeId);
  if (!node) throw new GraphError("missing-node", `no node ${nodeId}`);

  const parts: string[] = ["intent", node.intent];
  for (const edge of incomingEdges(state, nodeId)) parts.push(...part("edge", state, edge));
  for (const edge of inheritedNormative(state, nodeId)) {
    parts.push(...part("inherited", state, edge));
  }
  return hash(parts);
}

/**
 * The normative half of the digest — every rule binding this node, direct or
 * inherited. It decides nothing about freshness; `currentDigest` alone does
 * that. Its only job is to let a stale node name its reason: if this half is
 * unchanged, what moved was the foundation, not the policy.
 */
export function currentRuleDigest(state: GraphState, nodeId: string): string {
  if (!state.nodes.has(nodeId)) throw new GraphError("missing-node", `no node ${nodeId}`);

  const rules = new Map<string, Edge>();
  for (const edge of incomingEdges(state, nodeId)) {
    if (edge.aperture === "normative") rules.set(edge.id, edge);
  }
  for (const edge of inheritedNormative(state, nodeId)) rules.set(edge.id, edge);

  const parts: string[] = [];
  for (const edge of [...rules.values()].sort(compareEdges)) {
    parts.push(...part("rule", state, edge));
  }
  return hash(parts);
}
