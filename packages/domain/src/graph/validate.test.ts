import { describe, expect, it } from "vitest";
import { GraphError } from "../errors";
import { buildGraph } from "../testing";
import { reaches, validateEdgeAddition, validateGraph, wouldCreateCycle } from "./validate";

const three = () => buildGraph({ nodes: [{ id: "a" }, { id: "b" }, { id: "c" }] });

const code = (fn: () => void): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof GraphError) return error.code;
    throw error;
  }
  throw new Error("expected a GraphError");
};

describe("an invalid edge cannot be added", () => {
  it("rejects an edge from an unknown node", () => {
    const add = () =>
      validateEdgeAddition(three(), { id: "e1", from: "zzz", to: "b", aperture: "artifact" });
    expect(code(add)).toBe("missing-node");
  });

  it("rejects an edge to an unknown node", () => {
    const add = () =>
      validateEdgeAddition(three(), { id: "e1", from: "a", to: "zzz", aperture: "artifact" });
    expect(code(add)).toBe("missing-node");
  });

  it("rejects a self edge", () => {
    const add = () =>
      validateEdgeAddition(three(), { id: "e1", from: "a", to: "a", aperture: "artifact" });
    expect(code(add)).toBe("self-edge");
  });

  it("rejects a duplicate edge id", () => {
    const state = buildGraph({
      nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
      edges: [{ id: "e1", from: "a", to: "b", aperture: "artifact" }],
    });
    const add = () =>
      validateEdgeAddition(state, { id: "e1", from: "a", to: "c", aperture: "artifact" });
    expect(code(add)).toBe("duplicate-edge");
  });

  it("rejects a second edge between the same pair with the same aperture", () => {
    const state = buildGraph({
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ id: "e1", from: "a", to: "b", aperture: "artifact" }],
    });
    const add = () =>
      validateEdgeAddition(state, { id: "e2", from: "a", to: "b", aperture: "artifact" });
    expect(code(add)).toBe("duplicate-edge");
  });

  it("allows a second edge between the same pair with a different aperture", () => {
    const state = buildGraph({
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ id: "e1", from: "a", to: "b", aperture: "artifact" }],
    });
    expect(() =>
      validateEdgeAddition(state, { id: "e2", from: "a", to: "b", aperture: "normative" }),
    ).not.toThrow();
  });

  it("rejects an edge that would close a cycle", () => {
    const state = buildGraph({
      nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
      edges: [
        { id: "e1", from: "a", to: "b", aperture: "artifact" },
        { id: "e2", from: "b", to: "c", aperture: "artifact" },
      ],
    });
    const add = () =>
      validateEdgeAddition(state, { id: "e3", from: "c", to: "a", aperture: "artifact" });
    expect(code(add)).toBe("cycle");
    expect(wouldCreateCycle(state, "c", "a")).toBe(true);
    expect(wouldCreateCycle(state, "a", "c")).toBe(false);
    expect(reaches(state, "a", "c")).toBe(true);
    expect(reaches(state, "c", "a")).toBe(false);
  });
});

describe("a whole graph is checked the same way", () => {
  it("accepts a well-formed graph", () => {
    const state = buildGraph({
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ id: "e1", from: "a", to: "b", aperture: "artifact" }],
    });
    expect(() => validateGraph(state)).not.toThrow();
  });

  it("rejects a cycle that arrived from somewhere other than the log", () => {
    const state = buildGraph({
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [
        { id: "e1", from: "a", to: "b", aperture: "artifact" },
        { id: "e2", from: "b", to: "a", aperture: "artifact" },
      ],
    });
    expect(code(() => validateGraph(state))).toBe("cycle");
  });

  it("rejects an edge pointing at a node that is not there", () => {
    const state = buildGraph({ nodes: [{ id: "a" }] });
    const broken = {
      ...state,
      edges: new Map([["e1", { id: "e1", from: "a", to: "gone", aperture: "artifact" as const }]]),
    };
    expect(code(() => validateGraph(broken))).toBe("missing-node");
  });
});
