import { describe, expect, it } from "vitest";
import { GraphError } from "../errors";
import { currentDigest, currentRuleDigest } from "../graph/digest";
import { nodeState } from "../graph/state";
import { ev } from "../testing";
import { applyEvent, fold } from "./apply";
import type { OrbitalEvent } from "./types";

const code = (fn: () => void): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof GraphError) return error.code;
    throw error;
  }
  throw new Error("expected a GraphError");
};

const created = (id: string, requiresApproval = false): OrbitalEvent =>
  ev("NodeCreated", id, { nodeKind: "derivation", intent: `intent:${id}`, requiresApproval });

describe("nodes", () => {
  it("creates a node with no artifact", () => {
    const state = fold("g", [created("a")]);
    expect(state.nodes.get("a")).toMatchObject({ id: "a", artifactId: "", ruleDigest: "" });
    expect(nodeState(state, "a")).toBe("empty");
  });

  it("keeps the title when one is given", () => {
    const state = fold("g", [
      ev("NodeCreated", "a", { nodeKind: "source", intent: "the repo", title: "orbital" }),
    ]);
    expect(state.nodes.get("a")?.title).toBe("orbital");
  });

  it("rejects a second node with the same id", () => {
    expect(code(() => fold("g", [created("a"), created("a")]))).toBe("duplicate-node");
  });

  it("rejects an event addressed to a node that does not exist", () => {
    expect(code(() => fold("g", [ev("IntentChanged", "ghost", { intent: "x" })]))).toBe(
      "missing-node",
    );
  });

  it("rejects an event belonging to another graph", () => {
    const other = ev("NodeCreated", "a", { nodeKind: "derivation", intent: "x" }, { graphId: "h" });
    expect(code(() => fold("g", [other]))).toBe("wrong-graph");
  });

  it("takes incident edges and runs with a deleted node", () => {
    const state = fold("g", [
      created("a"),
      created("b"),
      ev("EdgeAdded", "b", { edgeId: "e1", from: "a", to: "b", aperture: "artifact" }),
      ev("RunStarted", "a", { runId: "r1" }),
      ev("NodeDeleted", "a", {}),
    ]);
    expect(state.nodes.has("a")).toBe(false);
    expect(state.edges.size).toBe(0);
    expect(state.runs.size).toBe(0);
  });
});

describe("edges", () => {
  it("adds an edge addressed to its consumer", () => {
    const state = fold("g", [
      created("a"),
      created("b"),
      ev("EdgeAdded", "b", { edgeId: "e1", from: "a", to: "b", aperture: "artifact" }),
    ]);
    expect(state.edges.get("e1")).toMatchObject({ from: "a", to: "b", aperture: "artifact" });
  });

  it("rejects an edge event addressed to the wrong end", () => {
    const misaddressed = () =>
      fold("g", [
        created("a"),
        created("b"),
        ev("EdgeAdded", "a", { edgeId: "e1", from: "a", to: "b", aperture: "artifact" }),
      ]);
    expect(code(misaddressed)).toBe("misaddressed-event");
  });

  it("rejects an edge that would close a cycle", () => {
    const cyclic = () =>
      fold("g", [
        created("a"),
        created("b"),
        ev("EdgeAdded", "b", { edgeId: "e1", from: "a", to: "b", aperture: "artifact" }),
        ev("EdgeAdded", "a", { edgeId: "e2", from: "b", to: "a", aperture: "artifact" }),
      ]);
    expect(code(cyclic)).toBe("cycle");
  });

  it("removes an edge", () => {
    const state = fold("g", [
      created("a"),
      created("b"),
      ev("EdgeAdded", "b", { edgeId: "e1", from: "a", to: "b", aperture: "artifact" }),
      ev("EdgeRemoved", "b", { edgeId: "e1" }),
    ]);
    expect(state.edges.size).toBe(0);
  });
});

describe("a run is a session, not an attempt", () => {
  const started = [created("a"), ev("RunStarted", "a", { runId: "r1", sessionId: "s1" })];

  it("is live while a process is alive", () => {
    const state = fold("g", started);
    expect(state.runs.get("r1")).toMatchObject({ status: "live", sessionId: "s1" });
    expect(nodeState(state, "a")).toBe("running");
  });

  it("produces an artifact without ending the run", () => {
    const state = fold("g", [
      ...started,
      ev("ArtifactProduced", "a", {
        runId: "r1",
        artifactId: "a1",
        artifactKind: "patch",
        inputDigest: "d",
        ruleDigest: "r",
      }),
    ]);
    expect(state.runs.get("r1")?.status).toBe("idle");
    expect(state.nodes.get("a")).toMatchObject({ artifactId: "a1", artifactKind: "patch" });
    expect(nodeState(state, "a")).not.toBe("running");
  });

  it("goes live again on Continue, and can produce a second artifact on the same run", () => {
    const state = fold("g", [
      ...started,
      ev("ArtifactProduced", "a", {
        runId: "r1",
        artifactId: "a1",
        artifactKind: "patch",
        inputDigest: "d",
        ruleDigest: "r",
      }),
      ev("MessageSent", "a", { runId: "r1", text: "also handle the empty case" }),
      ev("RunProgressed", "a", { runId: "r1" }),
      ev("ArtifactProduced", "a", {
        runId: "r1",
        artifactId: "a2",
        artifactKind: "patch",
        inputDigest: "d",
        ruleDigest: "r",
      }),
    ]);
    expect(state.runs.size).toBe(1);
    expect(state.nodes.get("a")?.artifactId).toBe("a2");
  });

  it("ends only on failure", () => {
    const state = fold("g", [...started, ev("RunFailed", "a", { runId: "r1", reason: "boom" })]);
    expect(state.runs.get("r1")?.status).toBe("failed");
    expect(nodeState(state, "a")).toBe("failed");
  });

  it("supersedes the previous run on Re-run rather than ending it", () => {
    const state = fold("g", [...started, ev("RunStarted", "a", { runId: "r2" })]);
    expect(state.runs.get("r1")?.status).toBe("idle");
    expect(state.runs.get("r2")?.status).toBe("live");
    expect(state.nodes.get("a")?.runId).toBe("r2");
  });

  it("rejects a run event addressed to the wrong node", () => {
    const wrong = () =>
      fold("g", [...started, created("b"), ev("RunFailed", "b", { runId: "r1" })]);
    expect(code(wrong)).toBe("misaddressed-event");
  });
});

describe("approval", () => {
  const gate = [
    created("a", true),
    ev("ArtifactProduced", "a", {
      artifactId: "a1",
      artifactKind: "decision",
      inputDigest: "d",
      ruleDigest: "r",
    }),
  ];

  it("records a decision against the artifact it was made on", () => {
    const state = fold("g", [...gate, ev("ApprovalDecided", "a", { decision: "approve", artifactId: "a1" })]);
    expect(state.approvals.get("a")).toMatchObject({ artifactId: "a1", decision: "approve" });
  });

  it("rejects a decision on a node that does not require one", () => {
    const ungated = () =>
      fold("g", [
        created("a"),
        ev("ArtifactProduced", "a", {
          artifactId: "a1",
          artifactKind: "patch",
          inputDigest: "d",
          ruleDigest: "r",
        }),
        ev("ApprovalDecided", "a", { decision: "approve", artifactId: "a1" }),
      ]);
    expect(code(ungated)).toBe("invalid-payload");
  });

  it("rejects a decision on an artifact the node does not hold", () => {
    const stale = () =>
      fold("g", [...gate, ev("ApprovalDecided", "a", { decision: "approve", artifactId: "a0" })]);
    expect(code(stale)).toBe("invalid-payload");
  });
});

describe("the fold does not depend on how nodes interleave", () => {
  /**
   * The digests are stated by the producer rather than recomputed here. That
   * is what makes this true: a fold that recomputed `inputDigest` would give a
   * different answer depending on whether the upstream artifact happened to be
   * folded first.
   */
  const scaffold: OrbitalEvent[] = [
    ev("NodeCreated", "a", { nodeKind: "source", intent: "the repo" }, { id: "s1", at: "2026-01-01T00:00:01Z" }),
    ev("NodeCreated", "b", { nodeKind: "derivation", intent: "write it up" }, { id: "s2", at: "2026-01-01T00:00:02Z" }),
    ev(
      "EdgeAdded",
      "b",
      { edgeId: "e1", from: "a", to: "b", aperture: "artifact" },
      { id: "s3", at: "2026-01-01T00:00:03Z" },
    ),
  ];

  const aEvents: OrbitalEvent[] = [
    ev("RunStarted", "a", { runId: "r1" }, { id: "a1", at: "2026-01-01T00:01:00Z" }),
    ev("RunProgressed", "a", { runId: "r1" }, { id: "a2", at: "2026-01-01T00:01:01Z" }),
    ev(
      "ArtifactProduced",
      "a",
      { runId: "r1", artifactId: "art-a", artifactKind: "document", inputDigest: "da", ruleDigest: "" },
      { id: "a3", at: "2026-01-01T00:01:02Z" },
    ),
  ];

  const bEvents: OrbitalEvent[] = [
    ev("RunStarted", "b", { runId: "r2" }, { id: "b1", at: "2026-01-01T00:02:00Z" }),
    ev("RunProgressed", "b", { runId: "r2" }, { id: "b2", at: "2026-01-01T00:02:01Z" }),
    ev(
      "ArtifactProduced",
      "b",
      { runId: "r2", artifactId: "art-b", artifactKind: "document", inputDigest: "db", ruleDigest: "" },
      { id: "b3", at: "2026-01-01T00:02:02Z" },
    ),
  ];

  const interleavings: readonly OrbitalEvent[][] = [
    [...aEvents, ...bEvents],
    [...bEvents, ...aEvents],
    [aEvents[0]!, bEvents[0]!, aEvents[1]!, bEvents[1]!, aEvents[2]!, bEvents[2]!],
    [bEvents[0]!, aEvents[0]!, aEvents[1]!, bEvents[1]!, bEvents[2]!, aEvents[2]!],
  ];

  it("reaches the same state for every valid interleaving", () => {
    const folded = interleavings.map((order) => fold("g", [...scaffold, ...order]));
    for (const state of folded) expect(state).toEqual(folded[0]);
  });
});

describe("the producer states the digest it consumed", () => {
  it("makes the node fresh when the claim matches the graph", () => {
    let state = fold("g", [
      ev("NodeCreated", "a", { nodeKind: "source", intent: "the repo" }),
      ev("NodeCreated", "b", { nodeKind: "derivation", intent: "write it up" }),
      ev("EdgeAdded", "b", { edgeId: "e1", from: "a", to: "b", aperture: "artifact" }),
      ev("ArtifactProduced", "a", {
        artifactId: "art-a",
        artifactKind: "document",
        inputDigest: "",
        ruleDigest: "",
      }),
    ]);

    // What an executor does: read the digest off the graph it is about to run
    // against, then state it back when the artifact lands.
    state = applyEvent(
      state,
      ev("ArtifactProduced", "b", {
        artifactId: "art-b",
        artifactKind: "document",
        inputDigest: currentDigest(state, "b"),
        ruleDigest: currentRuleDigest(state, "b"),
      }),
    );

    expect(nodeState(state, "b")).toBe("fresh");
  });
});
