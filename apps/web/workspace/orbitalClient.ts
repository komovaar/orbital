import type { AppRouter, GraphView } from "@orbital/contracts";
import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";

/**
 * The typed client. Every input and output below is *inferred* from the
 * server's router — nothing here declares a shape, and there is no schema to
 * keep in sync by discipline. Rename a field on the server and this package
 * stops compiling, which is the whole reason tRPC is here instead of plain
 * HTTP over hand-written types.
 *
 * Nothing in the canvas uses this yet; wiring the client onto it is phase 4.
 */
const url = `${import.meta.env.VITE_ORBITAL_SERVER ?? "http://localhost:4000"}`;

export const orbital = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      // Subscriptions arrive over SSE; everything else batches over POST.
      condition: (op) => op.type === "subscription",
      true: httpSubscriptionLink({ url }),
      false: httpBatchLink({ url }),
    }),
  ],
});

export type { GraphView };

/** The computed state of one node, as the server reports it. */
export type NodeStates = GraphView["states"];
