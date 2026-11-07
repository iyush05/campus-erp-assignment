import type { Database, SqlValue } from './database.ts';
type Prepared = { bind(...params: SqlValue[]): Prepared };
type D1Like = { prepare(sql: string): Prepared; batch(statements: Prepared[]): Promise<{ results?: Record<string, any>[]; meta?: { changes?: number } }[]> };
export function d1Database(binding: D1Like): Database {
  return { async batch(statements) {
    const result = await binding.batch(statements.map(s => binding.prepare(s.sql).bind(...s.params)));
    return result.map(r => ({rows:r.results ?? [],changes:r.meta?.changes ?? 0}));
  } };
}
