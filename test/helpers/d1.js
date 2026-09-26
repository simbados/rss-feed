// A minimal Cloudflare D1 stand-in for tests: Node's built-in SQLite (node:sqlite, no dependency)
// behind the part of the D1 API src/db.js uses — prepare().bind().first()/all()/run() and batch().
// Applies migrations/*.sql, with foreign keys enforced like D1.
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrationsDir = new URL('../../migrations/', import.meta.url);

/** A fresh in-memory database with all migrations applied. */
export function createTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationsDir), 'utf8'));
  }

  const plain = (row) => (row ? { ...row } : null);

  /** Runs a statement the way D1's batch() does and returns a D1-style result. */
  const execute = (sql, params) => {
    const st = sqlite.prepare(sql);
    if (st.columns().length) {
      const rows = st.all(...params).map(plain);
      return { results: rows, meta: { changes: rows.length } };
    }
    const r = st.run(...params);
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };

  const statement = (sql, params = []) => ({
    sql,
    params,
    bind: (...args) => statement(sql, args),
    first: async (column) => {
      const row = plain(sqlite.prepare(sql).get(...params));
      return row && column ? row[column] : row;
    },
    all: async () => ({ results: sqlite.prepare(sql).all(...params).map(plain), meta: {} }),
    run: async () => execute(sql, params),
  });

  return {
    sqlite,
    prepare: (sql) => statement(sql),
    /** Like D1: all statements in one transaction. */
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((s) => execute(s.sql, s.params));
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
