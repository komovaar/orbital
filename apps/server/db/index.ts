import Database from "better-sqlite3";
import { SCHEMA } from "./schema.ts";

export type Db = Database.Database;

/**
 * Open the database and bring the schema up to date.
 *
 * `WAL` because a read (the canvas polling state) must not block a write (a
 * run producing an artifact). `foreign_keys` is on for the view tables; the
 * log deliberately has none, since an event about a deleted node is still a
 * true record of something that happened.
 */
export function openDatabase(file: string): Db {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
