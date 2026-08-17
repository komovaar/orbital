import { currentDigest, currentRuleDigest } from "@orbital/domain";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { envelope, newId } from "../events.ts";
import { publicProcedure, router } from "../trpc.ts";

const artifactKind = z.enum(["patch", "document", "summary", "decision"]);

export const runRouter = router({
  /** Re-run: a new session over the same intent. */
  start: publicProcedure
    .input(
      z.object({
        graphId: z.string().min(1),
        nodeId: z.string().min(1),
        sessionId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const runId = newId("run");
      ctx.store.append(input.graphId, [
        {
          ...envelope(input.graphId, input.nodeId, ctx.actor),
          kind: "RunStarted",
          payload: {
            runId,
            ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
          },
        },
      ]);
      return { runId };
    }),

  /** Continue: another turn in the session that is already open. */
  message: publicProcedure
    .input(
      z.object({
        graphId: z.string().min(1),
        nodeId: z.string().min(1),
        runId: z.string().min(1),
        text: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) => {
      ctx.store.append(input.graphId, [
        {
          ...envelope(input.graphId, input.nodeId, ctx.actor),
          kind: "MessageSent",
          payload: { runId: input.runId, text: input.text },
        },
      ]);
      return { runId: input.runId };
    }),

  progress: publicProcedure
    .input(
      z.object({
        graphId: z.string().min(1),
        nodeId: z.string().min(1),
        runId: z.string().min(1),
        note: z.string().optional(),
        sessionId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      ctx.store.append(input.graphId, [
        {
          ...envelope(input.graphId, input.nodeId, ctx.actor),
          kind: "RunProgressed",
          payload: {
            runId: input.runId,
            ...(input.note === undefined ? {} : { note: input.note }),
            ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
          },
        },
      ]);
      return { runId: input.runId };
    }),

  /**
   * The digests are read off the graph the run was made against and stated in
   * the payload. The fold records the claim rather than recomputing it, which
   * is what keeps the result independent of how events from different nodes
   * interleave.
   */
  artifact: publicProcedure
    .input(
      z.object({
        graphId: z.string().min(1),
        nodeId: z.string().min(1),
        artifactId: z.string().min(1),
        artifactKind,
        runId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const state = ctx.store.state(input.graphId);
      if (!state.nodes.has(input.nodeId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: `no node ${input.nodeId}` });
      }
      ctx.store.append(input.graphId, [
        {
          ...envelope(input.graphId, input.nodeId, ctx.actor),
          kind: "ArtifactProduced",
          payload: {
            artifactId: input.artifactId,
            artifactKind: input.artifactKind,
            inputDigest: currentDigest(state, input.nodeId),
            ruleDigest: currentRuleDigest(state, input.nodeId),
            ...(input.runId === undefined ? {} : { runId: input.runId }),
          },
        },
      ]);
      return { artifactId: input.artifactId };
    }),

  fail: publicProcedure
    .input(
      z.object({
        graphId: z.string().min(1),
        nodeId: z.string().min(1),
        runId: z.string().min(1),
        reason: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      ctx.store.append(input.graphId, [
        {
          ...envelope(input.graphId, input.nodeId, ctx.actor),
          kind: "RunFailed",
          payload: {
            runId: input.runId,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
          },
        },
      ]);
      return { runId: input.runId };
    }),

  decide: publicProcedure
    .input(
      z.object({
        graphId: z.string().min(1),
        nodeId: z.string().min(1),
        decision: z.enum(["approve", "reject"]),
      }),
    )
    .mutation(({ ctx, input }) => {
      const node = ctx.store.state(input.graphId).nodes.get(input.nodeId);
      if (!node) {
        throw new TRPCError({ code: "NOT_FOUND", message: `no node ${input.nodeId}` });
      }
      ctx.store.append(input.graphId, [
        {
          ...envelope(input.graphId, input.nodeId, ctx.actor),
          kind: "ApprovalDecided",
          // The decision names the artifact it was made against, so a later
          // one returns the node to undecided without an event to say so.
          payload: { decision: input.decision, artifactId: node.artifactId },
        },
      ]);
      return { nodeId: input.nodeId, decision: input.decision };
    }),
});
