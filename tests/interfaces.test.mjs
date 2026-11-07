import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Login } from '../app/components/login.tsx';
import { StudentInterface, TeacherDashboard } from '../app/components/interfaces.tsx';
import { createSeed } from '../lib/seed.ts';
import { scopeState } from '../lib/domain.ts';

const render = (component, props) => renderToStaticMarkup(createElement(component, props));
function controller(role) {
    const access = { role, userId: `test_${role}`, displayName: `${role} person`, subjectIds: ['cs201'], studentIds: ['s-0412'] };
    return { role, access, owner: access.userId, state: scopeState(createSeed(), role, access), queue: [], cached: false, busy: false, online: true, mutate: async () => {}, refresh: async () => {} };
}
test('sign-in renders all role choices and keeps hosted sign-in on the identity provider', () => {
    const html = render(Login, {});
    for (const label of ['Student', 'Teacher', 'Office admin', 'Parent', 'Sign in to Campus', 'Continue with ChatGPT']) assert.ok(html.includes(label));
    assert.match(html, /href="\/signin-with-chatgpt\?return_to=%2F"/);
    assert.doesNotMatch(html, /account=local_/);
    assert.match(render(Login, { localMode: 'framework' }), /account=local_student/);
});
test('teacher dashboard renders only assigned classes and teaching actions', () => {
    const c = controller('faculty'), html = render(TeacherDashboard, { c, go() {}, takeClass() {} });
    assert.match(html, /TEACHER WORKSPACE/);
    assert.match(html, /Data Structures/);
    assert.match(html, /Mark attendance/);
    assert.match(html, /Manage my leave/);
    for (const subject of createSeed().subjects.filter(subject => subject.id !== 'cs201')) assert.ok(!html.includes(subject.name));
    assert.doesNotMatch(html, /Outstanding fees/);
});
test('student pages render scoped data and useful unpublished/empty states', () => {
    const c = controller('student');
    for (const page of ['overview', 'profile', 'register', 'marks', 'fees', 'messages', 'requests']) {
        const html = render(StudentInterface, { c, page, go() {} });
        assert.match(html, /STUDENT WORKSPACE/);
        for (const student of createSeed().students.filter(student => student.id !== 's-0412')) assert.ok(!html.includes(student.name));
        assert.doesNotMatch(html, /Take attendance|Save access|Edit staff access/);
    }
    assert.match(render(StudentInterface, { c, page: 'marks', go() {} }), /Results have not been published/);
    assert.match(render(StudentInterface, { c, page: 'register', go() {} }), /No dated attendance published yet/);
});
test('unassigned teachers and parents without linked records get actionable empty states', () => {
    const teacher = controller('faculty'); teacher.state.subjects = [];
    assert.match(render(TeacherDashboard, { c: teacher, go() {}, takeClass() {} }), /No classes assigned yet/);
    const parent = controller('parent'); parent.state.students = [];
    assert.match(render(StudentInterface, { c: parent, page: 'overview', go() {} }), /No student linked/);
});
