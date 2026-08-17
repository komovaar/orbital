import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";
import { EventSource } from "eventsource";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppRouter } from "./api/root.ts";
import { createServer } from "./index.ts";

/**
 * The in-process caller tests cover the routers. This one covers the wire:
 * a real socket, real JSON, and a real SSE stream. Between them they are the
 * difference between "the procedures work" and "a client can talk to this".
 */
let dir: string;
let server: ReturnType<typeof createServer>;
let client: ReturnType<typeof createTRPCClient<AppRouter>>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "orbital-http-"));
  server = createServer({ port: 0, databaseFile: path.join(dir, "orbital.db") });
  const port = await server.listen();
  const url = `http://localhost:${port}`;

  client = createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        // Browsers have EventSource; Node does not expose one by default.
        true: httpSubscriptionLink({ url, EventSource }),
        false: httpBatchLink({ url }),
      }),
    ],
  });
});

afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("over HTTP", () => {
  it("creates a graph and reads its computed state back", async () => {
    const { nodeId: repo } = await client.node.create.mutate({
      graphId: "wire",
      kind: "source",
      intent: "the repo",
    });
    const { nodeId: plan } = await client.node.create.mutate({
      graphId: "wire",
      kind: "derivation",
      intent: "write the plan",
    });
    await client.edge.add.mutate({
      graphId: "wire",
      from: repo,
      to: plan,
      aperture: "artifact",
    });

    const graph = await client.graph.get.query({ graphId: "wire" });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.states[plan]).toEqual({ state: "blocked", blockedReason: "unavailable-input" });

    await client.run.artifact.mutate({
      graphId: "wire",
      nodeId: repo,
      artifactId: "repo@1",
      artifactKind: "document",
    });
    const after = await client.graph.get.query({ graphId: "wire" });
    expect(after.states[repo]).toEqual({ state: "fresh" });
    expect(after.states[plan]).toEqual({ state: "empty" });
  });

  it("carries a domain rejection back as an error", async () => {
    await expect(
      client.edge.add.mutate({
        graphId: "wire",
        from: "nope",
        to: "also-nope",
        aperture: "artifact",
      }),
    ).rejects.toThrow(/missing-node/);
  });

  it("streams events as they are appended", async () => {
    const seen: string[] = [];
    const done = Promise.withResolvers<void>();

    const subscription = client.graph.onEvent.subscribe(
      { graphId: "stream", sinceSeq: 0 },
      {
        onData: (event) => {
          seen.push(event.data.kind);
          if (seen.length === 2) done.resolve();
        },
        onError: done.reject,
      },
    );

    await client.node.create.mutate({
      graphId: "stream",
      kind: "derivation",
      intent: "first",
    });
    await client.node.create.mutate({
      graphId: "stream",
      kind: "derivation",
      intent: "second",
    });

    await done.promise;
    subscription.unsubscribe();
    expect(seen).toEqual(["NodeCreated", "NodeCreated"]);
  });
});
