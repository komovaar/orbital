import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { appRouter } from "./api/root.ts";
import type { Context } from "./api/trpc.ts";
import { readEnv, type Env } from "./env.ts";
import { SqliteStore } from "./store/sqlite.ts";

export { appRouter, type AppRouter } from "./api/root.ts";
export type { GraphView } from "./api/routers/graph.ts";

/**
 * The long-lived process: one store, one router, one port.
 *
 * There is no scheduler and no executor yet — nothing runs. What exists is
 * the seam everything else will hang off: state that survives a restart, and
 * a contract a client can be typed against.
 */
export function createServer(env: Env = readEnv()) {
  if (env.databaseFile !== ":memory:") {
    mkdirSync(path.dirname(env.databaseFile), { recursive: true });
  }
  const store = new SqliteStore(env.databaseFile);

  const server = createHTTPServer({
    router: appRouter,
    createContext: (): Context => ({ store, actor: "user" }),
  });

  return {
    store,
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(env.port);
        server.once("listening", () => {
          const address = server.address();
          resolve(typeof address === "object" && address ? address.port : env.port);
        });
      }),
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}

// Started directly rather than imported: this is the process entry.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const env = readEnv();
  const server = createServer(env);
  const port = await server.listen();
  console.log(`orbital server on http://localhost:${port} (db: ${env.databaseFile})`);
}
