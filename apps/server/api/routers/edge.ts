import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { envelope, newId } from "../events.ts";
import { publicProcedure, router } from "../trpc.ts";

const aperture = z.enum(["artifact", "reference", "normative"]);

export const edgeRouter = router({
  add: publicProcedure
    .input(
      z.object({
        graphId: z.string().min(1),
        from: z.string().min(1),
        to: z.string().min(1),
        aperture,
        selector: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const edgeId = newId("edge");
      ctx.store.append(input.graphId, [
        {
          // An edge event is addressed to the consumer: the node whose inputs
          // just changed is the one the event is about.
          ...envelope(input.graphId, input.to, ctx.actor),
          kind: "EdgeAdded",
          payload: {
            edgeId,
            from: input.from,
            to: input.to,
            aperture: input.aperture,
            ...(input.selector === undefined ? {} : { selector: input.selector }),
          },
        },
      ]);
      return { edgeId };
    }),

  remove: publicProcedure
    .input(z.object({ graphId: z.string().min(1), edgeId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const edge = ctx.store.state(input.graphId).edges.get(input.edgeId);
      if (!edge) {
        throw new TRPCError({ code: "NOT_FOUND", message: `no edge ${input.edgeId}` });
      }
      ctx.store.append(input.graphId, [
        {
          ...envelope(input.graphId, edge.to, ctx.actor),
          kind: "EdgeRemoved",
          payload: { edgeId: input.edgeId },
        },
      ]);
      return { edgeId: input.edgeId };
    }),
});
