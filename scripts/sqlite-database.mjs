import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function openDatabase(path) {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON');
  // Preserve the old table for auditable migration; never rewrite or delete it.
  if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'").get()) sqlite.exec(readFileSync(new URL('../drizzle/0000_campus_workspace.sql',import.meta.url),'utf8'));
  if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='campus_workspaces'").get()) {
    sqlite.exec('BEGIN IMMEDIATE');
    try { sqlite.exec(readFileSync(new URL('../drizzle/0001_shared_campus.sql',import.meta.url),'utf8')); sqlite.exec('COMMIT'); }
    catch (e) { sqlite.exec('ROLLBACK'); sqlite.close(); throw e; }
  }
  if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erp_records'").get()) {
    sqlite.exec('BEGIN IMMEDIATE');
    try { sqlite.exec(readFileSync(new URL('../drizzle/0002_operations_and_portals.sql',import.meta.url),'utf8')); sqlite.exec('COMMIT'); }
    catch (e) { sqlite.exec('ROLLBACK'); sqlite.close(); throw e; }
  }
  if (!sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='mark_entries'").get().sql.includes('test BETWEEN -1 AND 40')) {
    sqlite.exec('BEGIN IMMEDIATE');
    try { sqlite.exec(readFileSync(new URL('../drizzle/0003_configurable_components.sql',import.meta.url),'utf8')); sqlite.exec('COMMIT'); }
    catch (e) { sqlite.exec('ROLLBACK'); sqlite.close(); throw e; }
  }
  return sqlite;
}
export function sqliteDatabase(sqlite) {
  return { async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(({sql,params}) => {
        const query = sqlite.prepare(sql);
        if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql)) return {rows:query.all(...params),changes:0};
        const result = query.run(...params); return {rows:[],changes:Number(result.changes)};
      });
      sqlite.exec('COMMIT'); return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}
