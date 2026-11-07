import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, sqliteDatabase } from '../scripts/sqlite-database.mjs';
import { bootstrapWorkspace, executeCommand, readSnapshot, publicResponse } from '../lib/server/repository.ts';
import { handleWorkspace } from '../lib/server/service.ts';
import { applyCommand, todayIST } from '../lib/domain.ts';
import { createSeed } from '../lib/seed.ts';
const owner = { userId: 'office_admin', displayName: 'Office Admin' };
const op = (type, payload) => ({ id: crypto.randomUUID(), type, payload });
const staff = (userId, extra = {}) => op('staff.save', { userId, displayName: userId, role: 'faculty', active: true, baseVersion: 0, subjectIds: ['cs201'], ...extra });
async function setup(t) {
  const sqlite = openDatabase(':memory:'); t.after(() => sqlite.close());
  const db = sqliteDatabase(sqlite); await bootstrapWorkspace(db, owner);
  const run = command => executeCommand(db, owner.userId, 'engineering-cse', command);
  return { sqlite, db, run };
}
const attendance = state => op('attendance.save', { subjectId: 'cs201', date: todayIST(), period: 1, baseVersion: 0, entries: Object.fromEntries(state.students.map(s => [s.id, true])) });

test('unprovisioned identities cannot bootstrap themselves or choose another campus', async t => {
  const { db } = await setup(t);
  await assert.rejects(readSnapshot(db, 'stranger'), e => e.status === 403);
  await bootstrapWorkspace(db, { userId: 'other_admin', displayName: 'Other Admin' }, 'other-campus');
  await assert.rejects(readSnapshot(db, owner.userId, 'other-campus'), e => e.status === 403);
  const response = await handleWorkspace(db, { userId: 'stranger', displayName: 'Stranger' }, new Request('https://campus.test/api/workspace'), { bootstrapOwnerId: owner.userId });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).accountId, 'stranger');
  assert.equal((await handleWorkspace(db, null, new Request('https://campus.test/api/workspace'))).status, 401);
});

test('staff permissions, assignment changes and revocation are enforced on reads and writes', async t => {
  const { db, run } = await setup(t);
  await run(staff('teacher_one')); await run(staff('teacher_two', { subjectIds: ['cs202'] }));
  const teacher = publicResponse(await readSnapshot(db, 'teacher_one'));
  assert.deepEqual(teacher.state.subjects.map(s => s.id), ['cs201']);
  await assert.rejects(executeCommand(db, 'teacher_one', 'engineering-cse', staff('rogue_admin', { role: 'admin' })), e => e.status === 403);
  const pending = attendance(teacher.state);
  await run(staff('teacher_one', { baseVersion: 1, subjectIds: [] }));
  const empty = publicResponse(await readSnapshot(db, 'teacher_one'));
  assert.deepEqual(empty.state.students, []); assert.deepEqual(empty.state.subjects, []);
  await assert.rejects(executeCommand(db, 'teacher_one', 'engineering-cse', pending), e => e.status === 403);
  await run(staff('teacher_one', { baseVersion: 2, active: false }));
  await assert.rejects(readSnapshot(db, 'teacher_one'), e => e.status === 403);
  await assert.rejects(executeCommand(db, 'teacher_one', 'engineering-cse', pending), e => e.status === 403);
  await assert.rejects(run(staff(owner.userId, { baseVersion: 1, active: false, role: 'admin' })), /Another admin/);
  await assert.rejects(run(staff('teacher_two', { baseVersion: 0 })), e => e.status === 409);
});

test('idempotency binds operation IDs to account and request content', async t => {
  const { db, run } = await setup(t);
  await run(staff('another_admin', { role: 'admin', subjectIds: [] }));
  const snapshot = await readSnapshot(db, owner.userId), student = snapshot.state.students.find(s => s.openingDue > 0);
  const payment = op('fees.pay', { studentId: student.id, amount: 100 });
  const first = await run(payment), retry = await run(payment);
  assert.equal(retry.revision, first.revision); assert.equal(retry.state.payments.length, 1);
  await assert.rejects(run({ ...payment, payload: { ...payment.payload, amount: 200 } }), e => e.status === 409);
  await assert.rejects(executeCommand(db, 'another_admin', 'engineering-cse', payment), e => e.status === 409);
});

test('concurrent attendance saves surface one conflict; unrelated payments both commit', async t => {
  const { db, run } = await setup(t), snapshot = await readSnapshot(db, owner.userId);
  const results = await Promise.allSettled([run(attendance(snapshot.state)), run(attendance(snapshot.state))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  const student = snapshot.state.students.find(s => s.openingDue > 1000);
  await Promise.all([run(op('fees.pay', { studentId: student.id, amount: 100 })), run(op('fees.pay', { studentId: student.id, amount: 200 }))]);
  const after = await readSnapshot(db, owner.userId);
  assert.equal(after.state.payments.length, 2); assert.equal(new Set(after.state.payments.map(p => p.receipt)).size, 2);
});

test('mid-transaction storage errors roll back records, audit, revision and operation acknowledgement', async t => {
  const { db, sqlite } = await setup(t), before = await readSnapshot(db, owner.userId);
  const failing = { batch: statements => db.batch(statements[0]?.sql.startsWith('UPDATE campus_workspaces') ? [...statements, { sql: 'INSERT INTO no_such_table VALUES (1)', params: [] }] : statements) };
  await assert.rejects(executeCommand(failing, owner.userId, 'engineering-cse', attendance(before.state)));
  const after = await readSnapshot(db, owner.userId);
  assert.equal(after.revision, before.revision); assert.deepEqual(after.state, before.state);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM processed_operations').get().n, 0);
});

test('revocation between read and commit prevents a queued attendance save', async t => {
  const { db, run } = await setup(t); await run(staff('teacher_one'));
  const before = await readSnapshot(db, 'teacher_one'); let revoked = false;
  const racing = { async batch(statements) {
    if (!revoked && statements[0]?.sql.startsWith('UPDATE campus_workspaces')) {
      revoked = true; await run(staff('teacher_one', { baseVersion: 1, active: false }));
    }
    return db.batch(statements);
  } };
  await assert.rejects(executeCommand(racing, 'teacher_one', 'engineering-cse', attendance(before.state)), e => e.status === 403);
  assert.deepEqual((await readSnapshot(db, owner.userId)).state.attendance, {});
});

test('legacy migration preserves original source, payment records, audit and replay IDs across restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'campus-migration-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'campus.sqlite'); let sqlite = openDatabase(path);
  t.after(() => sqlite.close());
  const seed = createSeed(), student = seed.students.find(s => s.openingDue > 0), payment = op('fees.pay', { studentId: student.id, amount: 100 });
  const legacy = applyCommand(seed, payment, 'admin');
  sqlite.prepare('INSERT INTO workspaces (owner_id,revision,data,updated_at) VALUES (?,1,?,?)').run(owner.userId, JSON.stringify(legacy), new Date().toISOString());
  await bootstrapWorkspace(sqliteDatabase(sqlite), owner); sqlite.close(); sqlite = openDatabase(path);
  const db = sqliteDatabase(sqlite); await bootstrapWorkspace(db, owner);
  const migrated = await readSnapshot(db, owner.userId);
  assert.deepEqual(migrated.state.students.toSorted((a,b) => a.id.localeCompare(b.id)), legacy.students.toSorted((a,b) => a.id.localeCompare(b.id))); assert.deepEqual(migrated.state.payments, legacy.payments);
  assert.equal(migrated.state.audit[0].actorUserId, owner.userId);
  assert.equal(sqlite.prepare('SELECT data FROM workspaces WHERE owner_id=?').get(owner.userId).data, JSON.stringify(legacy));
  assert.equal((await executeCommand(db, owner.userId, 'engineering-cse', payment)).state.payments.length, 1);
  assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('shared mark moderation persists and a racing draft save cannot cross the submission lock', async t => {
  const { db, run } = await setup(t); await run(staff('teacher_one'));
  const current = await readSnapshot(db, 'teacher_one');
  const rows = Object.fromEntries(current.state.students.map(s => [s.id, { test: 15, assignment: 8, practical: 8 }]));
  await executeCommand(db, 'teacher_one', 'engineering-cse', op('marks.save', { subjectId: 'cs201', baseVersion: 0, rows }));
  const submitted = await executeCommand(db, 'teacher_one', 'engineering-cse', op('marks.submit', { subjectId: 'cs201', baseVersion: 1 }));
  assert.equal(submitted.state.marks.cs201.status, 'Submitted');
  const results = await Promise.allSettled([
    run(op('marks.lock', { subjectId: 'cs201', baseVersion: 2 })),
    executeCommand(db, 'teacher_one', 'engineering-cse', op('marks.save', { subjectId: 'cs201', baseVersion: 2, rows })),
  ]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.status, 409);
  const after = await readSnapshot(db, 'teacher_one');
  assert.equal(after.state.marks.cs201.status, 'Locked'); assert.deepEqual(after.state.marks.cs201.rows, rows);
  await assert.rejects(executeCommand(db, 'teacher_one', 'engineering-cse', op('marks.reopen', { subjectId: 'cs201', baseVersion: 3, reason: 'Faculty attempt' })), e => e.status === 403);
  await run(op('marks.reopen', { subjectId: 'cs201', baseVersion: 3, reason: 'Approved correction' }));
  assert.equal((await readSnapshot(db, 'teacher_one')).state.marks.cs201.version, 4);
});

test('an admin with two memberships updates only the explicitly selected campus', async t => {
  const { db, run } = await setup(t); await bootstrapWorkspace(db, owner, 'second-campus');
  const initial = await readSnapshot(db, owner.userId, 'engineering-cse');
  const second = await readSnapshot(db, owner.userId, 'second-campus');
  assert.equal(initial.available.length, 2);
  const student = initial.state.students.find(s => s.openingDue > 0);
  await run(op('fees.pay', { studentId: student.id, amount: 250 }));
  assert.equal((await readSnapshot(db, owner.userId, 'engineering-cse')).state.payments.length, 1);
  const unchanged = await readSnapshot(db, owner.userId, 'second-campus');
  assert.equal(unchanged.revision, second.revision); assert.deepEqual(unchanged.state.payments, []);
});
