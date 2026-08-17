import { evaluateNode, type NodeEvaluation } from "@orbital/domain";
import { tracked } from "@trpc/server";
import { z } from "zod";
import type { StoredEvent } from "../../store/index.ts";
import { publicProcedure, router } from "../trpc.ts";

/**
 * The wire shape of a graph.
 *
 * `GraphState` holds Maps, which JSON has no opinion about, so everything
 * travels as arrays. `states` is computed here rather than stored — a client
 * must never be handed a status field that can drift out of agreement with
 * the graph it describes.
 */
export type GraphView = {
  readonly graphId: string;
  readonly nodes: readonly {
    readonly id: string;
    readonly kind: string;
    readonly title?: string;
    readonly intent: string;
    readonly requiresApproval: boolean;
    readonly artifactId: string;
    readonly artifactKind?: string;
    readonly runId?: string;
  }[];
  readonly edges: readonly {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly aperture: string;
    readonly selector?: string;
  }[];
  readonly runs: readonly {
    readonly id: string;
    readonly nodeId: string;
    readonly status: string;
    readonly sessionId?: string;
  }[];
  readonly states: Readonly<Record<string, NodeEvaluation>>;
};

export const graphRouter = router({
  get: publicProcedure
    .input(z.object({ graphId: z.string().min(1) }))
    .query(({ ctx, input }): GraphView => {
      const state = ctx.store.state(input.graphId);
      const states: Record<string, NodeEvaluation> = {};
      for (const id of state.nodes.keys()) states[id] = evaluateNode(state, id);

      return {
        graphId: state.graphId,
        nodes: [...state.nodes.values()].map((node) => ({
          id: node.id,
          kind: node.kind,
          intent: node.intent,
          requiresApproval: node.requiresApproval,
          artifactId: node.artifactId,
          ...(node.title === undefined ? {} : { title: node.title }),
          ...(node.artifactKind === undefined ? {} : { artifactKind: node.artifactKind }),
          ...(node.runId === undefined ? {} : { runId: node.runId }),
        })),
        edges: [...state.edges.values()],
        runs: [...state.runs.values()],
        states,
      };
    }),

  list: publicProcedure.query(({ ctx }) => ctx.store.graphIds()),

  events: publicProcedure
    .input(z.object({ graphId: z.string().min(1), sinceSeq: z.number().int().min(0).default(0) }))
    .query(({ ctx, input }) => ctx.store.events(input.graphId, input.sinceSeq)),

  /**
   * The event stream. Replays everything after the cursor first, then stays
   * open, so a client that reconnects misses nothing.
   *
   * Each event is `tracked()` by its sequence number, which SSE sends back as
   * `lastEventId` on reconnect. That means resumption is automatic: a dropped
   * connection does not need the client to have remembered where it was.
   */
  onEvent: publicProcedure
    .input(
      z.object({
        graphId: z.string().min(1),
        sinceSeq: z.number().int().min(0).default(0),
        lastEventId: z.string().nullish(),
      }),
    )
    .subscription(async function* ({ ctx, input, signal }) {
      let cursor = input.lastEventId ? Number(input.lastEventId) : input.sinceSeq;

      for (const event of ctx.store.events(input.graphId, cursor)) {
        cursor = event.seq;
        yield tracked(String(event.seq), event);
      }

      const queue: StoredEvent[] = [];
      let wake: (() => void) | undefined;
      const stop = ctx.store.subscribe((events) => {
        for (const event of events) {
          if (event.graphId === input.graphId && event.seq > cursor) queue.push(event);
        }
        wake?.();
      });

      try {
        while (signal?.aborted !== true) {
          while (queue.length > 0) {
            const event = queue.shift();
            if (!event) break;
            cursor = event.seq;
            yield tracked(String(event.seq), event);
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          wake = undefined;
        }
      } finally {
        stop();
      }
    }),

  view: publicProcedure
    .input(z.object({ graphId: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.store.view(input.graphId)),

  setPosition: publicProcedure
    .input(
      z.object({
        graphId: z.string().min(1),
        nodeId: z.string().min(1),
        x: z.number(),
        y: z.number(),
      }),
    )
    .mutation(({ ctx, input }) => {
      ctx.store.setPosition(input.graphId, { nodeId: input.nodeId, x: input.x, y: input.y });
      return ctx.store.view(input.graphId);
    }),

  clearPosition: publicProcedure
    .input(z.object({ graphId: z.string().min(1), nodeId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      ctx.store.clearPosition(input.graphId, input.nodeId);
      return ctx.store.view(input.graphId);
    }),

  putGroup: publicProcedure
    .input(
      z.object({
        graphId: z.string().min(1),
        groupId: z.string().min(1),
        title: z.string(),
        collapsed: z.boolean().default(false),
        members: z.array(z.string()),
      }),
    )
    .mutation(({ ctx, input }) => {
      ctx.store.putGroup(input.graphId, {
        groupId: input.groupId,
        title: input.title,
        collapsed: input.collapsed,
        members: input.members,
      });
      return ctx.store.view(input.graphId);
    }),

  deleteGroup: publicProcedure
    .input(z.object({ graphId: z.string().min(1), groupId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      ctx.store.deleteGroup(input.graphId, input.groupId);
      return ctx.store.view(input.graphId);
    }),
});
