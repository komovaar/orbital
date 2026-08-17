/**
 * The database is two things that must not be confused.
 *
 * `events` is the log — the record of what the graph *means*. It is append
 * only. Nothing in it is ever updated or deleted, because the whole point of
 * folding state from a log is that no version of the past is rewritten by
 * something that happens later.
 *
 * Everything else is derived or incidental. `snapshots` is a cache and can be
 * thrown away. The view tables hold how a person arranged the graph on a
 * screen — group membership and pinned positions — which is deliberately *not*
 * in the log (D10, D12).
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,
  id       TEXT NOT NULL UNIQUE,
  graph_id TEXT NOT NULL,
  node_id  TEXT NOT NULL,
  kind     TEXT NOT NULL,
  actor    TEXT NOT NULL,
  at       TEXT NOT NULL,
  payload  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_by_graph ON events (graph_id, seq);

-- A fold of the log up to and including through_seq. Purely an optimisation:
-- deleting every row here changes nothing except how long a read takes.
CREATE TABLE IF NOT EXISTS snapshots (
  graph_id    TEXT NOT NULL,
  through_seq INTEGER NOT NULL,
  state       TEXT NOT NULL,
  PRIMARY KEY (graph_id, through_seq)
);

-- View state below this line. A group has no intent, no artifact and no
-- digest, so it is not a node and has no business in the log.
CREATE TABLE IF NOT EXISTS node_positions (
  graph_id TEXT NOT NULL,
  node_id  TEXT NOT NULL,
  x        REAL NOT NULL,
  y        REAL NOT NULL,
  PRIMARY KEY (graph_id, node_id)
);

CREATE TABLE IF NOT EXISTS groups (
  graph_id  TEXT NOT NULL,
  group_id  TEXT NOT NULL,
  title     TEXT NOT NULL,
  collapsed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (graph_id, group_id)
);

CREATE TABLE IF NOT EXISTS group_members (
  graph_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  node_id  TEXT NOT NULL,
  PRIMARY KEY (graph_id, group_id, node_id)
);
`;
