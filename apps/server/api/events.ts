import { randomUUID } from "node:crypto";

/**
 * Ids and timestamps are minted here, on the server, rather than accepted from
 * a caller. Timestamps are advisory in any case — log order is what is
 * authoritative — but two clients disagreeing about the clock should not be
 * able to reorder anything.
 */
export const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;

export type Envelope = {
  readonly id: string;
  readonly graphId: string;
  readonly nodeId: string;
  readonly actor: string;
  readonly at: string;
};

export const envelope = (graphId: string, nodeId: string, actor: string): Envelope => ({
  id: newId("ev"),
  graphId,
  nodeId,
  actor,
  at: new Date().toISOString(),
});
