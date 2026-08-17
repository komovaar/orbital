import { EventLog } from "@orbital/domain";

/**
 * The long-lived Node process. A skeleton: it holds the store, the scheduler,
 * the executors and the tRPC API, none of which exist yet.
 *
 * What it does today is prove the seam — the server can see the domain, and
 * the domain cannot see the server.
 */
export function emptyWorkspace(graphId: string): EventLog {
  return EventLog.empty(graphId);
}
