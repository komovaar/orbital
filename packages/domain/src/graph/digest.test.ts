import { describe, expect, it } from "vitest";
import { buildGraph, withArtifact, withIntent } from "../testing";
import { currentDigest, inheritedNormative, normativeClosure } from "./digest";
import { nodeState } from "./state";
import type { GraphState } from "./types";

describe("the input digest", () => {
  it("moves when the intent moves", () => {
    const state = buildGraph({ nodes: [{ id: "a" }] });
    expect(currentDigest(state, "a")).not.toBe(currentDigest(withIntent(state, "a", "other"), "a"));
  });

  it("does not depend on the order edges were inserted in", () => {
    const nodes = [{ id: "a", kind: "source" as const }, { id: "b", kind: "source" as const }, { id: "c" }];
    const e1 = { id: "e1", from: "a", to: "c", aperture: "artifact" as const };
    const e2 = { id: "e2", from: "b", to: "c", aperture: "artifact" as const };
    const forwards = buildGraph({ nodes, edges: [e1, e2] });
    const backwards = buildGraph({ nodes, edges: [e2, e1] });
    expect(currentDigest(forwards, "c")).toBe(currentDigest(backwards, "c"));
  });

  it("distinguishes selectors", () => {
    const base = { nodes: [{ id: "a", kind: "source" as const }, { id: "b" }] };
    const whole = buildGraph({
      ...base,
      edges: [{ id: "e1", from: "a", to: "b", aperture: "artifact" }],
    });
    const slice = buildGraph({
      ...base,
      edges: [{ id: "e1", from: "a", to: "b", aperture: "artifact", selector: "§3" }],
    });
    expect(currentDigest(whole, "b")).not.toBe(currentDigest(slice, "b"));
  });
});

describe("reference contributes nothing", () => {
  const referring = (): GraphState => {
    let state = buildGraph({
      nodes: [{ id: "repo", kind: "source" }, { id: "b" }],
      edges: [{ id: "e1", from: "repo", to: "b", aperture: "reference" }],
    });
    state = withArtifact(state, "repo", "repo1");
    state = withArtifact(state, "b", "b1");
    return state;
  };

  it("leaves the consumer fresh when the source moves", () => {
    const state = withArtifact(referring(), "repo", "repo2");
    expect(nodeState(state, "b")).toBe("fresh");
  });

  it("still counts the edge's own identity", () => {
    const withEdge = referring();
    const withoutEdge = buildGraph({ nodes: [{ id: "repo", kind: "source" }, { id: "b" }] });
    expect(currentDigest(withEdge, "b")).not.toBe(currentDigest(withoutEdge, "b"));
  });
});

describe("normative rules travel down", () => {
  /** rule -> a, then a -> b -> d and a -> c -> d, so the rule reaches d twice. */
  const diamond = (): GraphState =>
    buildGraph({
      nodes: [
        { id: "rule", kind: "source" },
        { id: "a" },
        { id: "b" },
        { id: "c" },
        { id: "d" },
      ],
      edges: [
        { id: "r1", from: "rule", to: "a", aperture: "normative" },
        { id: "e1", from: "a", to: "b", aperture: "artifact" },
        { id: "e2", from: "a", to: "c", aperture: "artifact" },
        { id: "e3", from: "b", to: "d", aperture: "artifact" },
        { id: "e4", from: "c", to: "d", aperture: "artifact" },
      ],
    });

  it("reaches a node three levels down", () => {
    expect(inheritedNormative(diamond(), "d").map((edge) => edge.id)).toEqual(["r1"]);
  });

  it("counts a rule arriving over two paths once", () => {
    expect(normativeClosure(diamond(), "d")).toHaveLength(1);
  });

  it("travels through edges of every aperture", () => {
    const state = buildGraph({
      nodes: [{ id: "rule", kind: "source" }, { id: "a" }, { id: "b" }],
      edges: [
        { id: "r1", from: "rule", to: "a", aperture: "normative" },
        { id: "e1", from: "a", to: "b", aperture: "reference" },
      ],
    });
    expect(inheritedNormative(state, "b").map((edge) => edge.id)).toEqual(["r1"]);
  });

  it("does not count a node's direct rules as inherited", () => {
    const state = diamond();
    expect(inheritedNormative(state, "a")).toHaveLength(0);
    expect(normativeClosure(state, "a").map((edge) => edge.id)).toEqual(["r1"]);
  });

  it("stales every descendant when the rule's content moves — one hop each, not a wave", () => {
    let state = diamond();
    state = withArtifact(state, "rule", "rule1");
    for (const id of ["a", "b", "c", "d"]) state = withArtifact(state, id, `${id}1`);
    for (const id of ["a", "b", "c", "d"]) expect(nodeState(state, id)).toBe("fresh");

    state = withArtifact(state, "rule", "rule2");
    for (const id of ["a", "b", "c", "d"]) expect(nodeState(state, id)).toBe("stale");
  });
});
