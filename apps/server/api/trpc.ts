import { initTRPC } from "@trpc/server";
import type { Store } from "../store/index.ts";

export type Context = {
  readonly store: Store;
  /** Who is acting. Single-player today, but every event records it. */
  readonly actor: string;
};

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
