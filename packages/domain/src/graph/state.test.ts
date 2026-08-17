import { describe, expect, it } from "vitest";
import { buildGraph, withApproval, withArtifact, withIntent, withRun } from "../testing";
import { STATE_PRECEDENCE, evaluateNode, nodeState } from "./state";
import type { GraphState } from "./types";

const chain = (): GraphState =>
  buildGraph({
    nodes: [{ id: "a", kind: "source" }, { id: "b" }, { id: "c" }],
    edges: [
      { id: "e1", from: "a", to: "b", aperture: "artifact" },
      { id: "e2", from: "b", to: "c", aperture: "artifact" },
    ],
  });

/** a -> b -> c, every node holding an artifact made from its inputs. */
const freshChain = (): GraphState => {
  let state = chain();
  state = withArtifact(state, "a", "a1");
  state = withArtifact(state, "b", "b1");
  state = withArtifact(state, "c", "c1");
  return state;
};

describe("the state table", () => {
  it("is empty with no artifact", () => {
    expect(nodeState(buildGraph({ nodes: [{ id: "a" }] }), "a")).toBe("empty");
  });

  it("is fresh when the artifact was made from the inputs as they stand", () => {
    const state = withArtifact(buildGraph({ nodes: [{ id: "a" }] }), "a", "a1");
    expect(nodeState(state, "a")).toBe("fresh");
  });

  it("is stale once an input has moved", () => {
    let state = freshChain();
    state = withArtifact(state, "a", "a2");
    expect(evaluateNode(state, "b")).toEqual({ state: "stale", staleReason: "input-changed" });
  });

  it("is running while a process is alive", () => {
    const state = withRun(withArtifact(buildGraph({ nodes: [{ id: "a" }] }), "a", "a1"), "a", "r1", "live");
    expect(nodeState(state, "a")).toBe("running");
  });

  it("is failed when the last run failed", () => {
    const state = withRun(buildGraph({ nodes: [{ id: "a" }] }), "a", "r1", "failed");
    expect(nodeState(state, "a")).toBe("failed");
  });

  it("is not running once the session goes idle", () => {
    const state = withRun(withArtifact(buildGraph({ nodes: [{ id: "a" }] }), "a", "a1"), "a", "r1", "idle");
    expect(nodeState(state, "a")).toBe("fresh");
  });

  it("is blocked when an input has no artifact", () => {
    const state = chain();
    expect(evaluateNode(state, "b")).toEqual({
      state: "blocked",
      blockedReason: "unavailable-input",
    });
  });

  it("is pending when approval is required and undecided", () => {
    let state = buildGraph({ nodes: [{ id: "a", requiresApproval: true }] });
    state = withArtifact(state, "a", "a1");
    expect(nodeState(state, "a")).toBe("pending");
  });

  it("is rejected once a person has said no", () => {
    let state = buildGraph({ nodes: [{ id: "a", requiresApproval: true }] });
    state = withApproval(withArtifact(state, "a", "a1"), "a", "reject");
    expect(nodeState(state, "a")).toBe("rejected");
  });

  it("is fresh once approved", () => {
    let state = buildGraph({ nodes: [{ id: "a", requiresApproval: true }] });
    state = withApproval(withArtifact(state, "a", "a1"), "a", "approve");
    expect(nodeState(state, "a")).toBe("fresh");
  });

  it("returns to pending when a new artifact supersedes the decision", () => {
    let state = buildGraph({ nodes: [{ id: "a", requiresApproval: true }] });
    state = withApproval(withArtifact(state, "a", "a1"), "a", "approve");
    state = withArtifact(state, "a", "a2");
    expect(nodeState(state, "a")).toBe("pending");
  });

  it("covers every state in the union", () => {
    const reached = new Set(
      [
        nodeState(buildGraph({ nodes: [{ id: "a" }] }), "a"),
        nodeState(withArtifact(buildGraph({ nodes: [{ id: "a" }] }), "a", "a1"), "a"),
        nodeState(withArtifact(freshChain(), "a", "a2"), "b"),
        nodeState(withRun(buildGraph({ nodes: [{ id: "a" }] }), "a", "r1", "live"), "a"),
        nodeState(withRun(buildGraph({ nodes: [{ id: "a" }] }), "a", "r1", "failed"), "a"),
        nodeState(chain(), "b"),
        nodeState(
          withArtifact(buildGraph({ nodes: [{ id: "a", requiresApproval: true }] }), "a", "a1"),
          "a",
        ),
        nodeState(
          withApproval(
            withArtifact(buildGraph({ nodes: [{ id: "a", requiresApproval: true }] }), "a", "a1"),
            "a",
            "reject",
          ),
          "a",
        ),
      ].values(),
    );
    expect([...reached].sort()).toEqual([...STATE_PRECEDENCE].sort());
  });
});

describe("precedence", () => {
  it("running beats failed — a new live run supersedes a failed one", () => {
    let state = buildGraph({ nodes: [{ id: "a" }] });
    state = withRun(state, "a", "r1", "failed");
    state = withRun(state, "a", "r2", "live");
    expect(nodeState(state, "a")).toBe("running");
  });

  it("failed beats blocked", () => {
    const state = withRun(chain(), "b", "r1", "failed");
    expect(nodeState(state, "b")).toBe("failed");
  });

  it("blocked beats empty", () => {
    // b has no artifact of its own *and* an unavailable input.
    expect(nodeState(chain(), "b")).toBe("blocked");
  });

  it("blocked beats stale", () => {
    let state = freshChain();
    // c consumed b's artifact, then b's own input moved and b was re-run to
    // nothing: c is blocked by absence, not merely stale.
    state = withArtifact(state, "a", "a2");
    const nodes = new Map(state.nodes);
    const b = nodes.get("b");
    if (!b) throw new Error("no b");
    nodes.set("b", { ...b, artifactId: "" });
    expect(nodeState({ ...state, nodes }, "c")).toBe("blocked");
  });

  it("empty beats rejected — a decision about a gone artifact decides nothing", () => {
    let state = buildGraph({ nodes: [{ id: "a", requiresApproval: true }] });
    state = withApproval(withArtifact(state, "a", "a1"), "a", "reject");
    const nodes = new Map(state.nodes);
    const a = nodes.get("a");
    if (!a) throw new Error("no a");
    nodes.set("a", { ...a, artifactId: "" });
    expect(nodeState({ ...state, nodes }, "a")).toBe("empty");
  });

  it("rejected beats pending", () => {
    let state = buildGraph({ nodes: [{ id: "a", requiresApproval: true }] });
    state = withApproval(withArtifact(state, "a", "a1"), "a", "reject");
    expect(nodeState(state, "a")).toBe("rejected");
  });

  it("pending beats stale", () => {
    let state = buildGraph({
      nodes: [{ id: "a", kind: "source" }, { id: "b", requiresApproval: true }],
      edges: [{ id: "e1", from: "a", to: "b", aperture: "artifact" }],
    });
    state = withArtifact(state, "a", "a1");
    state = withArtifact(state, "b", "b1");
    state = withArtifact(state, "a", "a2");
    expect(nodeState(state, "b")).toBe("pending");
  });

  it("stale beats fresh", () => {
    const state = withIntent(withArtifact(buildGraph({ nodes: [{ id: "a" }] }), "a", "a1"), "a", "different");
    expect(nodeState(state, "a")).toBe("stale");
  });
});

describe("there is no staleness wave", () => {
  it("moves exactly one hop", () => {
    let state = freshChain();
    state = withArtifact(state, "a", "a2");

    expect(nodeState(state, "b")).toBe("stale");
    // c consumed b's artifact, and b's artifact has not changed.
    expect(nodeState(state, "c")).toBe("fresh");
  });

  it("advances a hop only when the parent actually re-runs", () => {
    let state = freshChain();
    state = withArtifact(state, "a", "a2");
    expect(nodeState(state, "c")).toBe("fresh");

    state = withArtifact(state, "b", "b2");
    expect(nodeState(state, "b")).toBe("fresh");
    expect(nodeState(state, "c")).toBe("stale");
  });

  it("does not treat a stale parent as blocking", () => {
    let state = freshChain();
    state = withArtifact(state, "a", "a2");
    // b is stale, but it still holds the artifact c consumed.
    expect(nodeState(state, "b")).toBe("stale");
    expect(evaluateNode(state, "c").blockedReason).toBeUndefined();
  });
});

describe("stale reasons", () => {
  const governed = (): GraphState => {
    let state = buildGraph({
      nodes: [{ id: "rule", kind: "source" }, { id: "a" }, { id: "b" }],
      edges: [
        { id: "e1", from: "rule", to: "a", aperture: "normative" },
        { id: "e2", from: "a", to: "b", aperture: "artifact" },
      ],
    });
    state = withArtifact(state, "rule", "rule1");
    state = withArtifact(state, "a", "a1");
    state = withArtifact(state, "b", "b1");
    return state;
  };

  it("names a moved foundation input-changed", () => {
    let state = governed();
    state = withArtifact(state, "a", "a2");
    expect(evaluateNode(state, "b")).toEqual({ state: "stale", staleReason: "input-changed" });
  });

  it("names a moved rule rule-changed, for the direct consumer and the inheritor alike", () => {
    let state = governed();
    state = withArtifact(state, "rule", "rule2");
    expect(evaluateNode(state, "a")).toEqual({ state: "stale", staleReason: "rule-changed" });
    expect(evaluateNode(state, "b")).toEqual({ state: "stale", staleReason: "rule-changed" });
  });

  it("names an intent change input-changed — policy did not move", () => {
    const state = withIntent(governed(), "b", "something else");
    expect(evaluateNode(state, "b")).toEqual({ state: "stale", staleReason: "input-changed" });
  });
});

describe("approval blocks a subtree", () => {
  const gated = (): GraphState => {
    let state = buildGraph({
      nodes: [{ id: "a", requiresApproval: true }, { id: "b" }, { id: "c" }],
      edges: [
        { id: "e1", from: "a", to: "b", aperture: "artifact" },
        { id: "e2", from: "b", to: "c", aperture: "artifact" },
      ],
    });
    state = withArtifact(state, "a", "a1");
    return state;
  };

  it("holds the subtree while the decision is undecided", () => {
    const state = gated();
    expect(nodeState(state, "a")).toBe("pending");
    expect(evaluateNode(state, "b")).toEqual({
      state: "blocked",
      blockedReason: "undecided-approval",
    });
    // c is blocked for free: b could not run, so b has no artifact.
    expect(evaluateNode(state, "c")).toEqual({
      state: "blocked",
      blockedReason: "unavailable-input",
    });
  });

  it("names rejection distinctly from silence", () => {
    const state = withApproval(gated(), "a", "reject");
    expect(nodeState(state, "a")).toBe("rejected");
    expect(evaluateNode(state, "b")).toEqual({
      state: "blocked",
      blockedReason: "rejected-input",
    });
  });

  it("releases the subtree on approval", () => {
    let state = withApproval(gated(), "a", "approve");
    expect(nodeState(state, "a")).toBe("fresh");
    expect(nodeState(state, "b")).toBe("empty");

    state = withArtifact(state, "b", "b1");
    expect(nodeState(state, "b")).toBe("fresh");
    expect(nodeState(state, "c")).toBe("empty");
  });

  it("prefers a definite no over a decision still owed", () => {
    let state = buildGraph({
      nodes: [
        { id: "yes", requiresApproval: true },
        { id: "no", requiresApproval: true },
        { id: "c" },
      ],
      edges: [
        { id: "e1", from: "yes", to: "c", aperture: "artifact" },
        { id: "e2", from: "no", to: "c", aperture: "artifact" },
      ],
    });
    state = withArtifact(state, "yes", "y1");
    state = withArtifact(state, "no", "n1");
    state = withApproval(state, "no", "reject");
    expect(evaluateNode(state, "c").blockedReason).toBe("rejected-input");
  });
});
