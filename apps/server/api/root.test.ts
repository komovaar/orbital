import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoredEvent } from "../store/index.ts";
import { SqliteStore } from "../store/sqlite.ts";
import { appRouter } from "./root.ts";
import { createCallerFactory } from "./trpc.ts";

const createCaller = createCallerFactory(appRouter);

let dir: string;
let file: string;
let store: SqliteStore;
let api: ReturnType<typeof createCaller>;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "orbital-api-"));
  file = path.join(dir, "orbital.db");
  store = new SqliteStore(file);
  api = createCaller({ store, actor: "tester" });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const graphId = "g";

/**
 * `tracked()` reaches an in-process caller as the raw `[id, event, meta]`
 * tuple; the HTTP client normalises it to `{ id, data }`. Neither shape is
 * this test's subject, so unwrap both and assert on the event.
 */
const unwrap = (yielded: unknown): StoredEvent =>
  Array.isArray(yielded)
    ? (yielded[1] as StoredEvent)
    : (yielded as { data: StoredEvent }).data;

const source = async (intent: string) =>
  (await api.node.create({ graphId, kind: "source", intent })).nodeId;

const derivation = async (intent: string, requiresApproval = false) =>
  (await api.node.create({ graphId, kind: "derivation", intent, requiresApproval })).nodeId;

describe("nodes and edges through the api", () => {
  it("creates a node and reports it as empty", async () => {
    const nodeId = await derivation("write the thing");
    const graph = await api.graph.get({ graphId });

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({ id: nodeId, intent: "write the thing" });
    expect(graph.states[nodeId]).toEqual({ state: "empty" });
  });

  it("creates an edge and blocks the consumer on its empty input", async () => {
    const a = await source("the repo");
    const b = await derivation("write it up");
    const { edgeId } = await api.edge.add({ graphId, from: a, to: b, aperture: "artifact" });

    const graph = await api.graph.get({ graphId });
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ id: edgeId, from: a, to: b, aperture: "artifact" });
    expect(graph.states[b]).toEqual({ state: "blocked", blockedReason: "unavailable-input" });
  });

  it("removes an edge without being told which end it belongs to", async () => {
    const a = await source("the repo");
    const b = await derivation("write it up");
    const { edgeId } = await api.edge.add({ graphId, from: a, to: b, aperture: "artifact" });
    await api.edge.remove({ graphId, edgeId });
    expect((await api.graph.get({ graphId })).edges).toHaveLength(0);
  });

  it("refuses an edge that would close a cycle", async () => {
    const a = await derivation("a");
    const b = await derivation("b");
    await api.edge.add({ graphId, from: a, to: b, aperture: "artifact" });
    await expect(
      api.edge.add({ graphId, from: b, to: a, aperture: "artifact" }),
    ).rejects.toThrow(/cycle/);
  });

  it("refuses an edge to a node that is not there", async () => {
    const a = await derivation("a");
    await expect(
      api.edge.add({ graphId, from: a, to: "ghost", aperture: "artifact" }),
    ).rejects.toThrow(/missing-node/);
  });

  it("deletes a node and its edges with it", async () => {
    const a = await source("the repo");
    const b = await derivation("write it up");
    await api.edge.add({ graphId, from: a, to: b, aperture: "artifact" });
    await api.node.delete({ graphId, nodeId: a });

    const graph = await api.graph.get({ graphId });
    expect(graph.nodes.map((node) => node.id)).toEqual([b]);
    expect(graph.edges).toHaveLength(0);
  });
});

describe("runs and approval through the api", () => {
  it("walks a node from empty to fresh", async () => {
    const nodeId = await derivation("write the thing");
    const { runId } = await api.run.start({ graphId, nodeId });
    expect((await api.graph.get({ graphId })).states[nodeId]).toEqual({ state: "running" });

    await api.run.artifact({ graphId, nodeId, runId, artifactId: "art1", artifactKind: "patch" });
    expect((await api.graph.get({ graphId })).states[nodeId]).toEqual({ state: "fresh" });
  });

  it("records a failure", async () => {
    const nodeId = await derivation("write the thing");
    const { runId } = await api.run.start({ graphId, nodeId });
    await api.run.fail({ graphId, nodeId, runId, reason: "boom" });
    expect((await api.graph.get({ graphId })).states[nodeId]).toEqual({ state: "failed" });
  });

  it("holds a gated node pending, then releases the subtree on approval", async () => {
    const gate = await derivation("decide the shape", true);
    const child = await derivation("build it");
    await api.edge.add({ graphId, from: gate, to: child, aperture: "artifact" });

    const { runId } = await api.run.start({ graphId, nodeId: gate });
    await api.run.artifact({
      graphId,
      nodeId: gate,
      runId,
      artifactId: "art1",
      artifactKind: "decision",
    });

    let graph = await api.graph.get({ graphId });
    expect(graph.states[gate]).toEqual({ state: "pending" });
    expect(graph.states[child]).toEqual({
      state: "blocked",
      blockedReason: "undecided-approval",
    });

    await api.run.decide({ graphId, nodeId: gate, decision: "approve" });
    graph = await api.graph.get({ graphId });
    expect(graph.states[gate]).toEqual({ state: "fresh" });
    expect(graph.states[child]).toEqual({ state: "empty" });
  });

  it("names rejection distinctly", async () => {
    const gate = await derivation("decide the shape", true);
    const child = await derivation("build it");
    await api.edge.add({ graphId, from: gate, to: child, aperture: "artifact" });
    const { runId } = await api.run.start({ graphId, nodeId: gate });
    await api.run.artifact({
      graphId,
      nodeId: gate,
      runId,
      artifactId: "art1",
      artifactKind: "decision",
    });
    await api.run.decide({ graphId, nodeId: gate, decision: "reject" });

    const graph = await api.graph.get({ graphId });
    expect(graph.states[gate]).toEqual({ state: "rejected" });
    expect(graph.states[child]).toEqual({ state: "blocked", blockedReason: "rejected-input" });
  });

  it("stales a consumer one hop when its input is re-run", async () => {
    const a = await source("the repo");
    const b = await derivation("write it up");
    const c = await derivation("summarise it");
    await api.edge.add({ graphId, from: a, to: b, aperture: "artifact" });
    await api.edge.add({ graphId, from: b, to: c, aperture: "artifact" });

    await api.run.artifact({ graphId, nodeId: a, artifactId: "a1", artifactKind: "document" });
    await api.run.artifact({ graphId, nodeId: b, artifactId: "b1", artifactKind: "document" });
    await api.run.artifact({ graphId, nodeId: c, artifactId: "c1", artifactKind: "summary" });

    await api.run.artifact({ graphId, nodeId: a, artifactId: "a2", artifactKind: "document" });

    const graph = await api.graph.get({ graphId });
    expect(graph.states[b]).toEqual({ state: "stale", staleReason: "input-changed" });
    expect(graph.states[c]).toEqual({ state: "fresh" });
  });
});

describe("view state through the api", () => {
  it("round-trips positions and groups without touching the log", async () => {
    const a = await derivation("a");
    await api.graph.setPosition({ graphId, nodeId: a, x: 4, y: 5 });
    await api.graph.putGroup({
      graphId,
      groupId: "grp1",
      title: "Auth",
      collapsed: true,
      members: [a],
    });

    const view = await api.graph.view({ graphId });
    expect(view.positions).toEqual([{ nodeId: a, x: 4, y: 5 }]);
    expect(view.groups).toEqual([
      { groupId: "grp1", title: "Auth", collapsed: true, members: [a] },
    ]);

    // One event: the node. Arranging a canvas is not a fact about the graph.
    expect(await api.graph.events({ graphId })).toHaveLength(1);
  });
});

describe("the event stream", () => {
  it("replays the backlog from a cursor and then stays open", async () => {
    const a = await derivation("a");
    // Breaking out of the `for await` below closes the generator, which is
    // what releases the store subscription in its `finally`.
    const stream = await api.graph.onEvent({ graphId, sinceSeq: 0 });

    const received: string[] = [];
    const reading = (async () => {
      for await (const event of stream) {
        received.push(unwrap(event).kind);
        if (received.length === 2) break;
      }
    })();

    await api.node.changeIntent({ graphId, nodeId: a, intent: "a, revised" });
    await reading;

    expect(received).toEqual(["NodeCreated", "IntentChanged"]);
  });

  it("delivers only what is newer than the cursor", async () => {
    await derivation("a");
    const events = await api.graph.events({ graphId });
    const head = events[events.length - 1];

    const stream = await api.graph.onEvent({ graphId, sinceSeq: head?.seq ?? 0 });

    const reading = (async () => {
      for await (const event of stream) return unwrap(event);
      return undefined;
    })();

    const b = await derivation("b");
    const first = await reading;

    expect(first).toMatchObject({ kind: "NodeCreated", nodeId: b });
  });
});

describe("state survives a restart", () => {
  it("comes back identical through the api", async () => {
    const a = await source("the repo");
    const b = await derivation("write it up");
    await api.edge.add({ graphId, from: a, to: b, aperture: "artifact" });
    await api.run.artifact({ graphId, nodeId: a, artifactId: "a1", artifactKind: "document" });
    const before = await api.graph.get({ graphId });

    store.close();
    store = new SqliteStore(file);
    api = createCaller({ store, actor: "tester" });

    expect(await api.graph.get({ graphId })).toEqual(before);
  });
});
