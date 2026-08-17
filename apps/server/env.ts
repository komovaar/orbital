import path from "node:path";

/**
 * Everything the process needs from its environment, read once and in one
 * place, so a missing variable fails at startup rather than at the first
 * request that happens to need it.
 */
export type Env = {
  readonly port: number;
  readonly databaseFile: string;
};

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const port = Number(source.ORBITAL_PORT ?? 4000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`ORBITAL_PORT is not a port: ${source.ORBITAL_PORT}`);
  }

  return {
    port,
    databaseFile: source.ORBITAL_DB ?? path.join(process.cwd(), ".orbital", "orbital.db"),
  };
}
