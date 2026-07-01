import { createRequire } from "module";

/**
 * Minimal SQLite abstraction used by the API.
 *
 * Production uses better-sqlite3 (fast native driver). When its native binding
 * is unavailable — e.g. sandboxes where the binary can't be compiled or the
 * prebuilt can't be downloaded — we transparently fall back to Node's built-in
 * `node:sqlite` (DatabaseSync), which ships inside Node 22+ and needs no binary.
 *
 * Both drivers expose the same synchronous prepare/run/get/all surface; the only
 * gap is `.transaction()`, which we polyfill over node:sqlite with BEGIN/COMMIT.
 */

export interface RunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface Statement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}

export interface Db {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  transaction(fn: () => void): () => void;
}

const require = createRequire(import.meta.url);

export function openDatabase(path: string): Db {
  // 1) Prefer better-sqlite3 (production). Importing it throws if the native
  //    binding is missing, so do it inside try/catch rather than a static import.
  try {
    const Better = require("better-sqlite3");
    const db = new Better(path);
    // better-sqlite3 already implements exec/prepare/transaction with this shape.
    return db as Db;
  } catch (err) {
    // 2) Fallback: Node's built-in SQLite.
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(path);
    console.warn(
      "[db] better-sqlite3 native binding unavailable — using built-in node:sqlite fallback."
    );
    return {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string): Statement => {
        const st = db.prepare(sql);
        return {
          run: (...params: unknown[]) => st.run(...params) as RunResult,
          get: (...params: unknown[]) => st.get(...params),
          all: (...params: unknown[]) => st.all(...params) as any[],
        };
      },
      transaction: (fn: () => void) => {
        // Mirror better-sqlite3's API: returns a function that runs `fn` inside
        // a transaction when invoked.
        return () => {
          db.exec("BEGIN");
          try {
            fn();
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
        };
      },
    };
  }
}
