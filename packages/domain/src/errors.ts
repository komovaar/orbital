export type GraphErrorCode =
  | "duplicate-node"
  | "duplicate-edge"
  | "duplicate-event"
  | "missing-node"
  | "missing-edge"
  | "self-edge"
  | "cycle"
  | "misaddressed-event"
  | "unknown-fork-point"
  | "wrong-graph"
  | "invalid-payload";

/** Every rejection the domain layer makes is one of these, with a stable code. */
export class GraphError extends Error {
  readonly code: GraphErrorCode;

  constructor(code: GraphErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "GraphError";
    this.code = code;
  }
}
