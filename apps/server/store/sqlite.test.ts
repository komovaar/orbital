import { GraphError, nodeState, type OrbitalEvent } from "@orbital/domain";
import { ev } from "@orbital/domain/testing";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStore } from "./sqlite.ts";

let dir: string;
let file: string;
let store: SqliteStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "orbital-store-"));
  file = path.join(dir, "orbital.db");
  store = new SqliteStore(file);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const node = (id: string, graphId = "g"): OrbitalEvent =>
  ev("NodeCreated", id, { nodeKind: "derivation", intent: `intent:${id}` }, { graphId });

const edge = (from: string, to: string, edgeId: string): OrbitalEvent =>
  ev("EdgeAdded", to, { edgeId, from, to, aperture: "artifact" });

describe("the log", () => {
  it("assigns log order, which is what is authoritative", () => {
    const stored = store.append("g", [node("a"), node("b")]);
    expect(stored.map((event) => event.seq)).toEqual([1, 2]);
  });

  it("folds to state", () => {
    store.append("g", [node("a"), node("b"), edge("a", "b", "e1")]);
    const state = store.state("g");
    expect([...state.nodes.keys()].sort()).toEqual(["a", "b"]);
    expect(state.edges.size).toBe(1);
  });

  it("reads back only what is newer than a sequence", () => {
    store.append("g", [node("a")]);
    const second = store.append("g", [node("b")]);
    expect(store.events("g", 1).map((event) => event.id)).toEqual([second[0]?.id]);
  });

  it("keeps graphs apart", () => {
    store.append("g", [node("a")]);
    store.append("h", [node("z", "h")]);
    expect(store.state("g").nodes.has("z")).toBe(false);
    expect(store.graphIds()).toEqual(["g", "h"]);
  });

  it("rejects an invalid mutation instead of writing it", () => {
    store.append("g", [node("a")]);
    expect(() => store.append("g", [node("a")])).toThrow(GraphError);
    expect(store.events("g")).toHaveLength(1);
  });

  it("writes a batch all or nothing", () => {
    // The second event is valid, the third closes a cycle. Nothing lands.
    expect(() =>
      store.append("g", [node("a"), node("b"), edge("a", "b", "e1"), edge("b", "a", "e2")]),
    ).toThrow(GraphError);
    expect(store.events("g")).toHaveLength(0);
  });

  it("notifies subscribers of what was appended", () => {
    const seen: string[] = [];
    const stop = store.subscribe((events) => seen.push(...events.map((event) => event.id)));
    const stored = store.append("g", [node("a"), node("b")]);
    stop();
    store.append("g", [node("c")]);
    expect(seen).toEqual(stored.map((event) => event.id));
  });
});

describe("state survives a restart", () => {
  it("comes back identical", () => {
    store.append("g", [node("a"), node("b"), edge("a", "b", "e1")]);
    store.append("g", [
      ev("ArtifactProduced", "a", {
        artifactId: "art-a",
        artifactKind: "document",
        inputDigest: "d",
        ruleDigest: "",
      }),
    ]);
    const before = store.state("g");

    store.close();
    store = new SqliteStore(file);

    expect(store.state("g")).toEqual(before);
    expect(nodeState(store.state("g"), "b")).toBe(nodeState(before, "b"));
  });
});

describe("snapshots", () => {
  /** Enough events to cross the snapshot threshold. */
  const many = (count: number): OrbitalEvent[] =>
    Array.from({ length: count }, (_, index) => node(`n${index}`));

  it("do not change what a fold produces", () => {
    store.append("g", many(150));
    const withSnapshot = store.state("g");
    expect(withSnapshot.nodes.size).toBe(150);

    // Throwing every snapshot away must leave the answer identical: they are
    // a cache, and the log is the truth.
    const bare = new SqliteStore(file);
    bare.close();
    const raw = new SqliteStore(file);
    raw.append("g", []);
    expect(raw.state("g")).toEqual(withSnapshot);
    raw.close();
  });

  it("keeps folding correct across the threshold", () => {
    store.append("g", many(99));
    expect(store.state("g").nodes.size).toBe(99);
    store.append("g", many(3).map((event, index) => ({ ...event, nodeId: `later${index}` })));
    expect(store.state("g").nodes.size).toBe(102);
  });
});

describe("view state lives beside the log, never in it", () => {
  it("stores and clears pinned positions", () => {
    store.append("g", [node("a")]);
    store.setPosition("g", { nodeId: "a", x: 10, y: 20 });
    expect(store.view("g").positions).toEqual([{ nodeId: "a", x: 10, y: 20 }]);

    store.setPosition("g", { nodeId: "a", x: 11, y: 21 });
    expect(store.view("g").positions).toEqual([{ nodeId: "a", x: 11, y: 21 }]);

    store.clearPosition("g", "a");
    expect(store.view("g").positions).toEqual([]);
  });

  it("stores groups with their membership", () => {
    store.append("g", [node("a"), node("b")]);
    store.putGroup("g", { groupId: "grp1", title: "Auth", collapsed: false, members: ["a", "b"] });
    expect(store.view("g").groups).toEqual([
      { groupId: "grp1", title: "Auth", collapsed: false, members: ["a", "b"] },
    ]);

    store.putGroup("g", { groupId: "grp1", title: "Auth", collapsed: true, members: ["a"] });
    expect(store.view("g").groups[0]).toMatchObject({ collapsed: true, members: ["a"] });

    store.deleteGroup("g", "grp1");
    expect(store.view("g").groups).toEqual([]);
  });

  it("leaves no trace in the event log", () => {
    store.append("g", [node("a")]);
    store.setPosition("g", { nodeId: "a", x: 1, y: 2 });
    store.putGroup("g", { groupId: "grp1", title: "Auth", collapsed: false, members: ["a"] });
    expect(store.events("g")).toHaveLength(1);
  });
});
