import test from 'node:test';
import assert from 'node:assert/strict';
import { sites } from '../scripts/vite/sites-vite-plugin.ts';
import { initializeLocalAccess } from '../lib/server/local-access.ts';
import { openDatabase, sqliteDatabase } from '../scripts/sqlite-database.mjs';
import { readSnapshot, executeCommand, publicResponse } from '../lib/server/repository.ts';
import { handleWorkspace } from '../lib/server/service.ts';
import { allowedPage, navigationFor } from '../lib/navigation.ts';

function middleware(mockAuth = true) {
    let run;
    sites({ mockAuth }).configureServer({ config: { server: {}, logger: { info() {} } }, middlewares: { use(fn) { run = fn; } } });
    return run;
}
function request(run, url = '/', headers = {}, remoteAddress = '127.0.0.1') {
    const req = { url, method: 'GET', headers: { host: 'localhost:5173', ...headers }, rawHeaders: Object.entries(headers).flat(), socket: { remoteAddress } };
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end() { this.ended = true; } };
    let next = false; run(req, res, () => { next = true; });
    return { req, res, next };
}

test('main app login selects a bounded identity and logout expires its HTTP-only cookie', () => {
    const run = middleware();
    for (const id of ['local_seedy', 'local_faculty', 'local_student', 'local_parent']) {
        const login = request(run, `/signin-with-chatgpt?account=${id}&return_to=%2F`);
        assert.equal(login.res.statusCode, 302);
        assert.match(login.res.headers['Set-Cookie'], /HttpOnly; SameSite=Lax/);
        const page = request(run, '/', { cookie: login.res.headers['Set-Cookie'].split(';')[0] });
        assert.equal(page.req.headers['oai-authenticated-user-id'], id);
    }
    const logout = request(run, '/signout-with-chatgpt?return_to=%2Flogin');
    assert.equal(logout.res.headers.Location, '/login');
    assert.match(logout.res.headers['Set-Cookie'], /Max-Age=0/);
    assert.equal(request(run).req.headers['oai-authenticated-user-id'], undefined);
});

test('development authentication rejects forged identities, off-host sign-in and unsafe redirects', () => {
    const run = middleware();
    assert.equal(request(run, '/', { 'oai-authenticated-user-id': 'local_seedy' }).req.headers['oai-authenticated-user-id'], undefined);
    assert.equal(request(run, '/', { cookie: '__sites_local_auth=unknown' }).req.headers['oai-authenticated-user-id'], undefined);
    assert.equal(request(run, '/', { cookie: '__sites_local_auth=local_seedy; __sites_local_auth=local_student' }).req.headers['oai-authenticated-user-id'], undefined);
    assert.equal(request(run, '/signin-with-chatgpt?account=arbitrary').res.statusCode, 400);
    assert.equal(request(run, '/signin-with-chatgpt', {}, '10.1.1.1').res.statusCode, 403);
    assert.equal(request(run, '/signin-with-chatgpt', { origin: 'https://evil.example' }).res.statusCode, 403);
    assert.equal(request(run, '/signin-with-chatgpt?return_to=https://evil.example').res.headers.Location, '/');
    assert.equal(middleware(false), undefined);
});

test('main app development accounts get distinct stored permissions and revocations are never restored', async t => {
    const sqlite = openDatabase(':memory:'); t.after(() => sqlite.close()); const db = sqliteDatabase(sqlite);
    await initializeLocalAccess(db);
    const teacher = publicResponse(await readSnapshot(db, 'local_faculty'));
    const student = publicResponse(await readSnapshot(db, 'local_student'));
    assert.equal(teacher.access.role, 'faculty');
    assert.deepEqual(teacher.state.subjects.map(s => s.id).sort(), ['cs201', 'cs203']);
    assert.deepEqual(teacher.state.payments, []);
    assert.equal(student.access.role, 'student');
    assert.deepEqual(student.state.students.map(s => s.id), ['s-0412']);
    assert.deepEqual(student.state.audit, []);
    assert.ok(Object.values(student.state.marks).every(batch => batch.status === 'Locked'));
    const denied = await handleWorkspace(db, { userId: 'local_student', displayName: 'Student' }, new Request('http://localhost/api/workspace', { method: 'POST', headers: { 'x-expected-user': 'local_student', 'x-workspace-id': 'engineering-cse' }, body: JSON.stringify({ id: crypto.randomUUID(), type: 'staff.save', payload: { userId: 'local_student', role: 'admin' } }) }));
    assert.equal(denied.status, 403);
    const admin = await readSnapshot(db, 'local_seedy');
    const member = admin.staff.find(member => member.userId === 'local_faculty');
    await executeCommand(db, 'local_seedy', 'engineering-cse', { id: crypto.randomUUID(), type: 'staff.save', payload: { ...member, active: false, baseVersion: member.version } });
    await initializeLocalAccess(db);
    await assert.rejects(readSnapshot(db, 'local_faculty'), /no active access/);
});

test('teacher and student deep links cannot select administration screens', () => {
    assert.equal(allowedPage('faculty', 'setup'), 'overview');
    assert.equal(allowedPage('faculty', 'fees'), 'overview');
    assert.equal(allowedPage('faculty', 'leave'), 'leave');
    assert.equal(allowedPage('student', 'attendance'), 'overview');
    assert.equal(allowedPage('student', 'students'), 'overview');
    assert.equal(allowedPage('student', 'marks'), 'marks');
    assert.ok(navigationFor('student').some(page => page.id === 'profile'));
});

test('student attendance omits cancelled periods and other students from the published view', async t => {
    const sqlite = openDatabase(':memory:'); t.after(() => sqlite.close()); const db = sqliteDatabase(sqlite);
    await initializeLocalAccess(db);
    const admin = await readSnapshot(db, 'local_seedy');
    const date = '2026-01-05', id = `cs201:${date}:1`;
    await executeCommand(db, 'local_seedy', 'engineering-cse', { id: crypto.randomUUID(), type: 'attendance.save', payload: { subjectId: 'cs201', date, period: 1, baseVersion: 0, entries: Object.fromEntries(admin.state.students.map(student => [student.id, false])) } });
    await executeCommand(db, 'local_seedy', 'engineering-cse', { id: crypto.randomUUID(), type: 'period.save', payload: { subjectId: 'cs201', date, period: 1, status: 'Cancelled', reason: 'Campus holiday', baseVersion: 0 } });
    const student = publicResponse(await readSnapshot(db, 'local_student'));
    assert.equal(student.state.attendance[id], undefined);
});
