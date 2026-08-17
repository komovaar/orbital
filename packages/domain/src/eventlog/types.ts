import type { Aperture, ArtifactKind, NodeKind } from "../graph/types";

export type EventKind =
  | "NodeCreated"
  | "IntentChanged"
  | "NodeDeleted"
  | "EdgeAdded"
  | "EdgeRemoved"
  | "RunStarted"
  | "MessageSent"
  | "RunProgressed"
  | "ArtifactProduced"
  | "RunFailed"
  | "ApprovalDecided";

type Envelope<K extends EventKind, P> = {
  readonly id: string;
  readonly graphId: string;
  /** An event is always addressed to an entity. Edge events belong to `to`. */
  readonly nodeId: string;
  readonly kind: K;
  /**
   * Who acted: a person or an agent. This is also where ownership lives —
   * who owns a node is the actor on its `NodeCreated`, not a field on `Node`.
   */
  readonly actor: string;
  /** ISO 8601. Advisory — log order is what is authoritative. */
  readonly at: string;
  readonly payload: P;
};

export type NodeCreatedEvent = Envelope<
  "NodeCreated",
  {
    readonly nodeKind: NodeKind;
    readonly intent: string;
    readonly title?: string;
    readonly requiresApproval?: boolean;
  }
>;

export type IntentChangedEvent = Envelope<
  "IntentChanged",
  { readonly intent: string; readonly title?: string }
>;

export type NodeDeletedEvent = Envelope<"NodeDeleted", Record<string, never>>;

export type EdgeAddedEvent = Envelope<
  "EdgeAdded",
  {
    readonly edgeId: string;
    readonly from: string;
    readonly to: string;
    readonly aperture: Aperture;
    readonly selector?: string;
  }
>;

export type EdgeRemovedEvent = Envelope<"EdgeRemoved", { readonly edgeId: string }>;

/** Opens a session. The previous run on the same node is superseded, not ended. */
export type RunStartedEvent = Envelope<
  "RunStarted",
  { readonly runId: string; readonly sessionId?: string }
>;

/** A person's turn inside a run — this is Continue. */
export type MessageSentEvent = Envelope<
  "MessageSent",
  { readonly runId: string; readonly text: string }
>;

/** The agent's turn. */
export type RunProgressedEvent = Envelope<
  "RunProgressed",
  { readonly runId: string; readonly note?: string; readonly sessionId?: string }
>;

/**
 * An artifact, without ending the run — a run may produce several.
 *
 * The digests are carried, not recomputed at fold time. The producer states
 * which inputs it consumed; the fold only records the claim. That is what
 * makes the fold independent of how events from different nodes interleave,
 * and a fold whose result depends on evaluation order is a fold with a bug in
 * it. `ruleDigest` rides along for the same reason: recomputing it later would
 * reintroduce exactly the order-dependence `inputDigest` avoids.
 */
export type ArtifactProducedEvent = Envelope<
  "ArtifactProduced",
  {
    readonly runId?: string;
    readonly artifactId: string;
    readonly artifactKind: ArtifactKind;
    readonly inputDigest: string;
    readonly ruleDigest: string;
  }
>;

/** The only event that ends a run. Its own kind, so "this run is over" is legible. */
export type RunFailedEvent = Envelope<
  "RunFailed",
  { readonly runId: string; readonly reason?: string }
>;

/**
 * A ruling against the node's current artifact. Naming the artifact is what
 * makes a later `ArtifactProduced` return the node to undecided without an
 * event to say so.
 */
export type ApprovalDecidedEvent = Envelope<
  "ApprovalDecided",
  { readonly decision: "approve" | "reject"; readonly artifactId: string }
>;

export type OrbitalEvent =
  | NodeCreatedEvent
  | IntentChangedEvent
  | NodeDeletedEvent
  | EdgeAddedEvent
  | EdgeRemovedEvent
  | RunStartedEvent
  | MessageSentEvent
  | RunProgressedEvent
  | ArtifactProducedEvent
  | RunFailedEvent
  | ApprovalDecidedEvent;
