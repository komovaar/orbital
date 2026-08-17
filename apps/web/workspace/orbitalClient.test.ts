import type { GraphView } from "@orbital/contracts";
import { describe, expect, it } from "vitest";
import { orbital } from "./orbitalClient";

/**
 * These assertions are checked by `tsc`, not by vitest — the runtime body is
 * incidental. Their job is to fail the *build* if the server's contract moves
 * underneath the client, which is phase 2's last acceptance criterion.
 */
type Assert<T extends true> = T;

// Rename `states` on GraphView and this line stops compiling.
export type _HasStates = Assert<"states" extends keyof GraphView ? true : false>;
export type _HasNodes = Assert<"nodes" extends keyof GraphView ? true : false>;
export type _HasEdges = Assert<"edges" extends keyof GraphView ? true : false>;

// The inputs are inferred too: `graphId` is required and is a string.
type GetInput = Parameters<typeof orbital.graph.get.query>[0];
export type _GraphIdIsString = Assert<GetInput extends { graphId: string } ? true : false>;

// And the outputs: a node carries its intent, not a status field.
type Node = Awaited<ReturnType<typeof orbital.graph.get.query>>["nodes"][number];
export type _NodeHasIntent = Assert<Node extends { intent: string } ? true : false>;
export type _NodeHasNoStatus = Assert<"status" extends keyof Node ? false : true>;

describe("the typed client", () => {
  it("exposes the routers the server defines", () => {
    expect(typeof orbital.graph.get.query).toBe("function");
    expect(typeof orbital.node.create.mutate).toBe("function");
    expect(typeof orbital.edge.add.mutate).toBe("function");
    expect(typeof orbital.run.start.mutate).toBe("function");
    expect(typeof orbital.graph.onEvent.subscribe).toBe("function");
  });
});
