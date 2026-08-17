import { applyEvent, emptyGraph, type GraphState, type OrbitalEvent } from "@orbital/domain";
import { openDatabase, type Db } from "../db/index.ts";
import { decodeState, encodeState } from "./snapshot.ts";
import type { Group, NodePosition, StoredEvent, Store, ViewState } from "./index.ts";

/**
 * How many events may sit between a snapshot and the head before another is
 * written. Folding is cheap; this only stops it growing without bound.
 */
const SNAPSHOT_EVERY = 100;

type EventRow = {
  seq: number;
  id: string;
  graph_id: string;
  node_id: string;
  kind: string;
  actor: string;
  at: string;
  payload: string;
};

const toEvent = (row: EventRow): StoredEvent =>
  ({
    seq: row.seq,
    id: row.id,
    graphId: row.graph_id,
    nodeId: row.node_id,
    kind: row.kind,
    actor: row.actor,
    at: row.at,
    payload: JSON.parse(row.payload) as unknown,
  }) as StoredEvent;

export class SqliteStore implements Store {
  private readonly db: Db;
  private readonly listeners = new Set<(events: readonly StoredEvent[]) => void>();

  constructor(file: string) {
    this.db = openDatabase(file);
  }

  /**
   * The log is written one row at a time. The old worker rewrote a whole
   * state snapshot under a file lock on every change, which is what turns a
   * canvas back into a queue — two nodes cannot make progress at once if
   * every change contends for the same file.
   */
  append(graphId: string, events: readonly OrbitalEvent[]): readonly StoredEvent[] {
    if (events.length === 0) return [];

    const insert = this.db.prepare(
      `INSERT INTO events (id, graph_id, node_id, kind, actor, at, payload)
       VALUES (@id, @graph_id, @node_id, @kind, @actor, @at, @payload)`,
    );

    const write = this.db.transaction((batch: readonly OrbitalEvent[]) => {
      // Validate the whole batch against the state it will actually land on,
      // so a batch cannot be half-written and half-rejected.
      let state = this.state(graphId);
      for (const event of batch) state = applyEvent(state, event);

      const stored: StoredEvent[] = [];
      for (const event of batch) {
        const info = insert.run({
          id: event.id,
          graph_id: event.graphId,
          node_id: event.nodeId,
          kind: event.kind,
          actor: event.actor,
          at: event.at,
          payload: JSON.stringify(event.payload),
        });
        stored.push({ ...event, seq: Number(info.lastInsertRowid) });
      }

      const head = stored[stored.length - 1];
      if (head) this.maybeSnapshot(graphId, state, head.seq);
      return stored;
    });

    const stored = write(events);
    for (const listener of this.listeners) listener(stored);
    return stored;
  }

  events(graphId: string, sinceSeq = 0): readonly StoredEvent[] {
    const rows = this.db
      .prepare<[string, number], EventRow>(
        `SELECT * FROM events WHERE graph_id = ? AND seq > ? ORDER BY seq`,
      )
      .all(graphId, sinceSeq);
    return rows.map(toEvent);
  }

  state(graphId: string): GraphState {
    const snapshot = this.db
      .prepare<[string], { through_seq: number; state: string }>(
        `SELECT through_seq, state FROM snapshots WHERE graph_id = ?
         ORDER BY through_seq DESC LIMIT 1`,
      )
      .get(graphId);

    const decoded = snapshot ? decodeState(snapshot.state) : undefined;
    // A snapshot this build cannot read is simply ignored: re-folding the
    // whole log is slower and always correct.
    const from = decoded && snapshot ? snapshot.through_seq : 0;

    let state = decoded ?? emptyGraph(graphId);
    for (const event of this.events(graphId, from)) state = applyEvent(state, event);
    return state;
  }

  graphIds(): readonly string[] {
    return this.db
      .prepare<[], { graph_id: string }>(`SELECT DISTINCT graph_id FROM events ORDER BY graph_id`)
      .all()
      .map((row) => row.graph_id);
  }

  view(graphId: string): ViewState {
    const positions = this.db
      .prepare<[string], { node_id: string; x: number; y: number }>(
        `SELECT node_id, x, y FROM node_positions WHERE graph_id = ? ORDER BY node_id`,
      )
      .all(graphId)
      .map((row) => ({ nodeId: row.node_id, x: row.x, y: row.y }));

    const members = this.db
      .prepare<[string], { group_id: string; node_id: string }>(
        `SELECT group_id, node_id FROM group_members WHERE graph_id = ? ORDER BY node_id`,
      )
      .all(graphId);

    const groups = this.db
      .prepare<[string], { group_id: string; title: string; collapsed: number }>(
        `SELECT group_id, title, collapsed FROM groups WHERE graph_id = ? ORDER BY group_id`,
      )
      .all(graphId)
      .map((row) => ({
        groupId: row.group_id,
        title: row.title,
        collapsed: row.collapsed === 1,
        members: members.filter((m) => m.group_id === row.group_id).map((m) => m.node_id),
      }));

    return { positions, groups };
  }

  setPosition(graphId: string, position: NodePosition): void {
    this.db
      .prepare(
        `INSERT INTO node_positions (graph_id, node_id, x, y) VALUES (?, ?, ?, ?)
         ON CONFLICT (graph_id, node_id) DO UPDATE SET x = excluded.x, y = excluded.y`,
      )
      .run(graphId, position.nodeId, position.x, position.y);
  }

  clearPosition(graphId: string, nodeId: string): void {
    this.db
      .prepare(`DELETE FROM node_positions WHERE graph_id = ? AND node_id = ?`)
      .run(graphId, nodeId);
  }

  putGroup(graphId: string, group: Group): void {
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO groups (graph_id, group_id, title, collapsed) VALUES (?, ?, ?, ?)
           ON CONFLICT (graph_id, group_id)
           DO UPDATE SET title = excluded.title, collapsed = excluded.collapsed`,
        )
        .run(graphId, group.groupId, group.title, group.collapsed ? 1 : 0);
      this.db
        .prepare(`DELETE FROM group_members WHERE graph_id = ? AND group_id = ?`)
        .run(graphId, group.groupId);
      const member = this.db.prepare(
        `INSERT INTO group_members (graph_id, group_id, node_id) VALUES (?, ?, ?)`,
      );
      for (const nodeId of group.members) member.run(graphId, group.groupId, nodeId);
    });
    write();
  }

  deleteGroup(graphId: string, groupId: string): void {
    const write = this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM group_members WHERE graph_id = ? AND group_id = ?`)
        .run(graphId, groupId);
      this.db.prepare(`DELETE FROM groups WHERE graph_id = ? AND group_id = ?`).run(graphId, groupId);
    });
    write();
  }

  subscribe(listener: (events: readonly StoredEvent[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.db.close();
  }

  private maybeSnapshot(graphId: string, state: GraphState, headSeq: number): void {
    const latest = this.db
      .prepare<[string], { through_seq: number }>(
        `SELECT through_seq FROM snapshots WHERE graph_id = ? ORDER BY through_seq DESC LIMIT 1`,
      )
      .get(graphId);

    if (headSeq - (latest?.through_seq ?? 0) < SNAPSHOT_EVERY) return;

    this.db
      .prepare(`INSERT OR REPLACE INTO snapshots (graph_id, through_seq, state) VALUES (?, ?, ?)`)
      .run(graphId, headSeq, encodeState(state));
    // One snapshot per graph is all a fold ever reads.
    this.db
      .prepare(`DELETE FROM snapshots WHERE graph_id = ? AND through_seq < ?`)
      .run(graphId, headSeq);
  }
}
