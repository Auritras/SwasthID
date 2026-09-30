// A stand-in for Cloudflare D1, backed by Node's built-in SQLite.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function createD1(schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')) {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const statement = (sql, args = []) => ({
    sql, args,
    bind: (...values) => statement(sql, values),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => db.prepare(sql).run(...args),
  });
  return {
    raw: db,
    prepare: sql => statement(sql),
    batch: async statements => {
      db.exec('BEGIN');
      try {
        const out = statements.map(s => db.prepare(s.sql).run(...s.args));
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
