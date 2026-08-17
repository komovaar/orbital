import { z } from "zod";
import { envelope, newId } from "../events.ts";
import { publicProcedure, router } from "../trpc.ts";

const nodeKind = z.enum(["source", "derivation", "watcher"]);

export const nodeRouter = router({
  create: publicProcedure
    .input(
      z.object({
        graphId: z.string().min(1),
        kind: nodeKind,
        intent: z.string().min(1),
        title: z.string().optional(),
        requiresApproval: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) => {
      const nodeId = newId("node");
      ctx.store.append(input.graphId, [
        {
          ...envelope(input.graphId, nodeId, ctx.actor),
          kind: "NodeCreated",
          payload: {
            nodeKind: input.kind,
            intent: input.intent,
            requiresApproval: input.requiresApproval,
            ...(input.title === undefined ? {} : { title: input.title }),
          },
        },
      ]);
      return { nodeId };
    }),

  changeIntent: publicProcedure
    .input(
      z.object({
        graphId: z.string().min(1),
        nodeId: z.string().min(1),
        intent: z.string().min(1),
        title: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      ctx.store.append(input.graphId, [
        {
          ...envelope(input.graphId, input.nodeId, ctx.actor),
          kind: "IntentChanged",
          payload: {
            intent: input.intent,
            ...(input.title === undefined ? {} : { title: input.title }),
          },
        },
      ]);
      return { nodeId: input.nodeId };
    }),

  delete: publicProcedure
    .input(z.object({ graphId: z.string().min(1), nodeId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      ctx.store.append(input.graphId, [
        {
          ...envelope(input.graphId, input.nodeId, ctx.actor),
          kind: "NodeDeleted",
          payload: {},
        },
      ]);
      return { nodeId: input.nodeId };
    }),
});
