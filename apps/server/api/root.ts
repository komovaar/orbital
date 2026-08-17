import { edgeRouter } from "./routers/edge.ts";
import { graphRouter } from "./routers/graph.ts";
import { nodeRouter } from "./routers/node.ts";
import { runRouter } from "./routers/run.ts";
import { router } from "./trpc.ts";

export const appRouter = router({
  graph: graphRouter,
  node: nodeRouter,
  edge: edgeRouter,
  run: runRouter,
});

/**
 * The contract, written once. Clients derive their types from this rather
 * than declaring their own — which is the entire reason for tRPC being here
 * instead of plain HTTP. Rename a field below and the client stops compiling.
 */
export type AppRouter = typeof appRouter;
