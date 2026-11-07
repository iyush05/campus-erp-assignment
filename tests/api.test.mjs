import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { createPreviewHandler, openPreviewDatabase } from '../scripts/local-preview.mjs';
import { todayIST } from '../lib/domain.ts';
const headersFor = (user = 'local_demo', workspace = 'engineering-cse') => ({ cookie: `campus_demo_account=${user}`, 'x-expected-user': user, 'x-workspace-id': workspace });
const request = (handler, { method = 'GET', url = '/api/workspace', body, headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = Readable.from(body ? [typeof body === 'string' ? body : JSON.stringify(body)] : []);
  Object.assign(req, { method, url, headers: { host: '127.0.0.1:4173', ...headers } });
  const res = { status: 200, headers: {}, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { resolve({ status: this.status, headers: this.headers, body: this.headers['Content-Type'] === 'application/json' ? JSON.parse(body) : body }); } };
  Promise.resolve(handler(req, res)).catch(reject);
});
const setup = t => {
  const db = openPreviewDatabase(':memory:'); t.after(() => db.close());
  return { db, handler: createPreviewHandler(db, { root: resolve('outputs/local-preview') }) };
};
const attendance = state => ({ id: crypto.randomUUID(), type: 'attendance.save', payload: { subjectId: 'cs201', date: todayIST(), period: 1, baseVersion: 0, entries: Object.fromEntries(state.students.map(s => [s.id, true])) } });

test('SQLite API shares saved attendance, scopes accounts and acknowledges retries once', async t => {
  const { db, handler } = setup(t), initial = await request(handler);
  assert.equal(initial.status, 200); assert.equal(initial.body.state.students.length, 24);
  const faculty = await request(handler, { headers: headersFor('local_faculty') });
  assert.equal(faculty.body.access.role, 'faculty'); assert.equal(faculty.body.state.subjects.length, 2);
  assert.ok(faculty.body.state.students.every(s => s.openingDue === 0));
  assert.deepEqual(faculty.body.staff, []); assert.deepEqual(faculty.body.state.audit, []);
  const op = attendance(initial.body.state);
  const saved = await request(handler, { method: 'POST', body: op, headers: headersFor('local_faculty') });
  assert.equal(saved.status, 200); assert.equal(saved.body.revision, initial.body.revision + 1);
  const retry = await request(handler, { method: 'POST', body: op, headers: headersFor('local_faculty') });
  assert.equal(retry.status, 200); assert.equal(retry.body.revision, saved.body.revision);
  const stale = await request(handler, { method: 'POST', body: { ...op, id: crypto.randomUUID() }, headers: headersFor('local_faculty') });
  assert.equal(stale.status, 409);
  const read = await request(handler); assert.equal(Object.keys(read.body.state.attendance).length, 1);
  assert.equal(read.body.state.audit.filter(a => a.id === op.id).length, 1);
  assert.equal(read.body.state.audit.find(a => a.id === op.id).actorUserId, 'local_faculty');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attendance_entries').get().n, 24);
  const otherFaculty = await request(handler, { headers: headersFor('local_faculty_amit') });
  assert.equal(otherFaculty.body.state.subjects.length, 1); assert.deepEqual(otherFaculty.body.state.attendance, {});
});

test('API ignores forged roles and rejects missing account/campus guards and invalid requests', async t => {
  const { handler } = setup(t);
  assert.equal((await request(handler, { method: 'POST', body: '{', headers: headersFor() })).status, 400);
  assert.equal((await request(handler, { method: 'DELETE' })).status, 405);
  assert.equal((await request(handler, { method: 'POST', body: {}, headers: { ...headersFor(), origin: 'https://example.com' } })).status, 403);
  assert.equal((await request(handler, { headers: { host: 'evil.example' } })).status, 403);
  const initial = await request(handler), op = attendance(initial.body.state);
  assert.equal((await request(handler, { method: 'POST', body: op })).status, 401);
  assert.equal((await request(handler, { method: 'POST', body: op, headers: { 'x-expected-user': 'local_demo' } })).status, 400);
  assert.equal((await request(handler, { method: 'POST', body: op, headers: { ...headersFor('local_faculty'), 'x-expected-user': 'local_demo' } })).status, 401);
  assert.equal((await request(handler, { headers: { cookie: 'campus_demo_account=unknown' } })).status, 401);
  const forged = { ...headersFor('local_faculty'), 'x-demo-role': 'admin' };
  assert.equal((await request(handler, { headers: forged })).body.access.role, 'faculty');
  assert.equal((await request(handler, { method: 'POST', headers: forged, body: { id: crypto.randomUUID(), type: 'fees.pay', payload: { studentId: initial.body.state.students[1].id, amount: 100 } } })).status, 403);
  assert.equal((await request(handler, { method: 'POST', headers: forged, body: { ...op, payload: { ...op.payload, subjectId: 'cs202' } } })).status, 403);
});

test('local account selection uses a cookie and new tabs can discover the selected identity', async t => {
  const { handler } = setup(t);
  const selected = await request(handler, { url: '/api/demo/account', method: 'POST', body: { userId: 'local_faculty' } });
  assert.equal(selected.status, 200); assert.match(selected.headers['Set-Cookie'], /HttpOnly; SameSite=Strict/);
  const read = await request(handler, { headers: { cookie: selected.headers['Set-Cookie'].split(';')[0] } });
  assert.equal(read.body.owner, 'local_faculty'); assert.equal(read.body.access.role, 'faculty');
  const identity = await request(handler, { url: '/api/demo/account', headers: { cookie: selected.headers['Set-Cookie'].split(';')[0] } });
  assert.equal(identity.body.owner, 'local_faculty');
  assert.equal((await request(handler, { url: '/api/demo/account', method: 'POST', body: { userId: 'unknown' } })).status, 403);
});

test('built client shell and service worker are served by the preview handler', async t => {
  const { handler } = setup(t);
  const page = await request(handler, { url: '/' }); assert.equal(page.status, 200); assert.match(String(page.body), /Campus/);
  const worker = await request(handler, { url: '/sw.js' }); assert.equal(worker.status, 200); assert.match(String(worker.body), /PREPARE_OFFLINE/);
});
