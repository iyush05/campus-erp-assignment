import type { Workspace, Student, Command, Role, MarkRow, ActorScope } from './types.ts';
import { DomainError } from './errors.ts';
export { DomainError } from './errors.ts';
import { applyERPCommand, scopeERP, feeAdjustment, cancelledPeriod } from './erp.ts';
export const facultyName = 'Dr. Priyanka Das';
export const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function attendanceRate(state: Workspace, student: Student) {
    const sessions = Object.values(state.attendance).filter(s => typeof s.entries[student.id] === 'boolean' && !cancelledPeriod(state, s.id));
    const held = (student.baseline?.held ?? 0) + sessions.length;
    const present = (student.baseline?.present ?? 0) + sessions.filter(s => s.entries[student.id]).length;
    return held ? Math.round(present / held * 1000) / 10 : null;
}
export function dueFor(state: Workspace, student: Student) { return Math.max(0, student.openingDue + feeAdjustment(state, student.id) - state.payments.filter(p => p.studentId === student.id).reduce((n, p) => n + p.amount, 0)); }
export function markTotal(row?: MarkRow) { return !row || Object.values(row).some(x => x === null) ? null : Math.max(0,row.test!) + Math.max(0,row.assignment!) + Math.max(0,row.practical!); }
export function evidenceFor(state: Workspace, student: Student) {
    const attendance = attendanceRate(state, student);
    const totals = Object.values(state.marks).map(b => markTotal(b.rows[student.id])).filter((v): v is number => v !== null);
    const mean = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
    const lowAttendance = attendance !== null && attendance < state.settings.attendanceThreshold, lowMarks = mean !== null && mean < 24;
    return { attendance, mean, flagged: lowAttendance || lowMarks, reason: lowAttendance && lowMarks ? 'Attendance & marks' : lowAttendance ? 'Attendance shortage' : lowMarks ? 'Low internal marks' : 'On track', evidence: `${attendance === null ? 'Attendance history unavailable' : `${attendance}% attendance`}; ${mean === null ? 'marks incomplete' : `${mean.toFixed(1)}/40 average internal marks`}. Fixed demo thresholds: attendance <75%, marks <24/40. No trend prediction.` };
}
function assert(condition: unknown, message: string, status = 400): asserts condition { if (!condition)
    throw new DomainError(message, status); }
export function scopeState(state: Workspace, role: Role, actor: ActorScope = {}): Workspace {
    if (role === 'admin')
        return state;
    if (role === 'student' || role === 'parent') {
        const ids = new Set(actor.studentIds ?? []);
        return { ...state, erp: scopeERP(state, role, actor), students: state.students.filter(s => ids.has(s.id)),
            marks: Object.fromEntries(Object.entries(state.marks).filter(([,b]) => b.status === 'Locked').map(([id,b]) => [id,{...b,rows:Object.fromEntries(Object.entries(b.rows).filter(([student]) => ids.has(student)))}])),
            attendance: Object.fromEntries(Object.entries(state.attendance).filter(([id,a]) => !cancelledPeriod(state,id) && Object.keys(a.entries).some(student => ids.has(student))).map(([id,a]) => [id,{...a,entries:Object.fromEntries(Object.entries(a.entries).filter(([student]) => ids.has(student)))}])),
            payments: state.payments.filter(p => ids.has(p.studentId)), tasks: [], audit: [], operations: [] };
    }
    const subjects = state.subjects.filter(s => actor.subjectIds ? actor.subjectIds.includes(s.id) : s.faculty === facultyName), ids = new Set(subjects.map(s => s.id));
    return { ...state, erp: scopeERP(state, role, actor), subjects, tasks: state.tasks.filter(t => actor.userId ? t.mentorUserId === actor.userId : t.mentor === facultyName), operations: [], students: subjects.length ? state.students.map(s => ({ ...s, openingDue: 0 })) : [], payments: [], audit: [], marks: Object.fromEntries(Object.entries(state.marks).filter(([id]) => ids.has(id))), attendance: Object.fromEntries(Object.entries(state.attendance).filter(([, a]) => ids.has(a.subjectId))) };
}
export function applyCommand(original: Workspace, command: Command, role: Role, now = new Date().toISOString(), actor: ActorScope = {}): Workspace {
    assert(command && typeof command.id === 'string' && command.id.length >= 8 && command.id.length <= 100, 'A valid operation ID is required.');
    assert(command.payload && typeof command.payload === 'object', 'Invalid operation payload.');
    assert(role === 'admin' || role === 'faculty' || ['privacy.request','payment.order','payment.completeTest'].includes(command.type), 'This portal account cannot change academic or financial records.', 403);
    if (original.operations.includes(command.id))
        return original;
    const state: Workspace = structuredClone(original), p = command.payload;
    const admin = () => assert(role === 'admin', 'Office admin permission is required.', 403);
    const subject = (id: string) => { const s = state.subjects.find(s => s.id === id); assert(s, 'Subject not found.', 404); assert(role === 'admin' || (actor.subjectIds ? actor.subjectIds.includes(s.id) : s.faculty === facultyName), 'This subject is outside your faculty assignment.', 403); return s; };
    let detail = '';
    switch (command.type) {
        case 'attendance.save': {
            const s = subject(p.subjectId);
            assert(!cancelledPeriod(state, `${p.subjectId}:${p.date}:${p.period}`), 'This period is cancelled. An admin must restore it before attendance can be recorded.');
            assert(typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.date <= todayIST() && !Number.isNaN(Date.parse(p.date)) && new Date(p.date).toISOString().slice(0, 10) === p.date, 'Choose a valid class date, no later than today.');
            assert(Number.isInteger(p.period) && p.period >= 1 && p.period <= 8, 'Period must be between 1 and 8.');
            const id = `${p.subjectId}:${p.date}:${p.period}`, existing = state.attendance[id];
            assert((existing?.version ?? 0) === p.baseVersion, 'This class was changed on another device. Review the server register before replacing it.', 409);
            assert(p.entries && Object.keys(p.entries).length === state.students.length && state.students.every(s => typeof p.entries[s.id] === 'boolean'), 'Every enrolled student must be marked. Refresh the roster if it has changed.');
            assert(!existing || (typeof p.reason === 'string' && p.reason.trim().length >= 5), 'Give a reason for correcting submitted attendance.');
            state.attendance[id] = { id, subjectId: s.id, date: p.date, period: p.period, entries: p.entries, version: (existing?.version ?? 0) + 1, updatedAt: now };
            detail = `${s.name} · ${p.date} · period ${p.period}: ${Object.values(p.entries).filter(Boolean).length}/${state.students.length} present.${existing ? ` Correction: ${p.reason}. Before: ${JSON.stringify(existing.entries)}. After: ${JSON.stringify(p.entries)}` : ''}`;
            break;
        }
        case 'marks.export': {
            const s = subject(p.subjectId), batch = state.marks[s.id];
            assert(batch.status === 'Locked' && batch.version === p.baseVersion,'Export requires the current locked batch.',409);
            (state.erp ??= {records:[]}).records.push({id:command.id,kind:'markExport',version:1,createdAt:now,updatedAt:now,createdBy:actor.userId ?? 'system',data:{subjectId:s.id,subjectCode:s.code,batchVersion:batch.version,format:'generic-v1',components:state.settings.components ?? {test:20,assignment:10,practical:10},rows:state.students.map(st=>({roll:st.roll,name:st.name,...batch.rows[st.id],total:markTotal(batch.rows[st.id])}))}});
            detail = `Exported locked ${s.code}, version ${batch.version}, generic-v1`; break;
        }
        case 'marks.save': {
            const s = subject(p.subjectId), batch = state.marks[s.id];
            assert(batch.status === 'Draft', 'Marks are submitted or locked. An admin must return or reopen this batch.', 409);
            assert(batch.version === p.baseVersion, 'Marks changed in another session. Refresh before saving.', 409);
            assert(p.rows && Object.keys(p.rows).length === state.students.length, 'Provide the full student marks register.');
            for (const student of state.students) {
                const row = p.rows[student.id];
                assert(row && typeof row === 'object' && Object.keys(row).length === 3, 'Provide exactly the three assessment components.');
                for (const [key, max] of [['test', state.settings.components?.test ?? 20], ['assignment', state.settings.components?.assignment ?? 10], ['practical', state.settings.components?.practical ?? 10]] as const)
                    assert(row[key] === null || (Number.isInteger(row[key]) && row[key] >= -1 && row[key] <= max), `${key} marks must be whole numbers between 0 and ${max}, or Absent (-1).`);
            }
            detail = `${s.name}: before ${JSON.stringify(batch.rows)}; after ${JSON.stringify(p.rows)}`;
            batch.rows = p.rows;
            batch.version++;
            break;
        }
        case 'marks.submit':
        case 'marks.lock':
        case 'marks.reopen': {
            const s = subject(p.subjectId), batch = state.marks[s.id];
            assert(batch.version === p.baseVersion, 'Marks changed in another session. Refresh first.', 409);
            if (command.type === 'marks.submit') {
                assert(batch.status === 'Draft', 'Only draft marks can be submitted.');
                assert(state.students.every(s => markTotal(batch.rows[s.id]) !== null), 'Enter all marks before submitting. Zero is valid; blank means not entered.');
                batch.status = 'Submitted';
            }
            else if (command.type === 'marks.lock') {
                admin();
                assert(batch.status === 'Submitted', 'Submit the batch before moderation.');
                batch.status = 'Locked';
            }
            else {
                admin();
                assert(batch.status !== 'Draft', 'This batch is already a draft.');
                assert(typeof p.reason === 'string' && p.reason.trim().length >= 5, 'A reason is required to return or reopen marks.');
                batch.status = 'Draft';
            }
            batch.version++;
            detail = `${s.name}: ${batch.status}, version ${batch.version}${p.reason ? `. Reason: ${p.reason}` : ''}`;
            break;
        }
        case 'fees.pay': {
            admin();
            const student = state.students.find(s => s.id === p.studentId);
            assert(student, 'Student not found.');
            const due = dueFor(state, student);
            assert(due > 0, 'This student has no outstanding dues.');
            assert(Number.isSafeInteger(p.amount) && p.amount > 0 && p.amount <= due, 'Payment must be positive and cannot exceed current dues.');
            state.payments.push({ id: command.id, studentId: student.id, amount: p.amount, at: now, receipt: `TEST-${String(state.payments.length + 1).padStart(5, '0')}` });
            detail = `TEST payment ₹${(p.amount / 100).toFixed(2)} allocated to ${student.roll}`;
            break;
        }
        case 'support.flag': {
            const visible = scopeState(state, role, actor), student = state.students.find(s => s.id === p.studentId);
            assert(student && visible.students.some(s => s.id === student.id), 'This student is outside your faculty assignment.', 403);
            const evidence = evidenceFor(visible, student);
            assert(evidence.flagged, 'This student does not meet the demo support thresholds.');
            assert(!state.tasks.some(t => t.studentId === student.id && t.status !== 'Closed'), 'An open mentor task already exists.');
            state.tasks.push({ id: command.id, studentId: student.id, reason: evidence.reason, evidence: evidence.evidence, status: 'Open', mentor: actor.displayName ?? facultyName, mentorUserId: actor.userId, at: now });
            detail = `Mentor review created for ${student.roll}: ${evidence.evidence}`;
            break;
        }
        case 'support.update': {
            const task = state.tasks.find(t => t.id === p.taskId);
            assert(task, 'Task not found.');
            assert(role === 'admin' || (actor.userId ? task.mentorUserId === actor.userId : task.mentor === facultyName), 'This mentor task is outside your assignment.', 403);
            assert(['Open', 'In progress', 'Closed'].includes(p.status), 'Invalid task status.');
            task.status = p.status;
            detail = `Mentor task ${task.id}: ${p.status}`;
            break;
        }
        case 'students.import': {
            admin();
            assert(Array.isArray(p.students) && p.students.length > 0 && p.students.length <= 200, 'Import between 1 and 200 students.');
            const rolls = new Set(state.students.map(s => s.roll));
            for (const row of p.students) {
                assert(typeof row.name === 'string' && row.name.trim().length > 1 && row.name.length <= 100, 'Every student needs a valid name.');
                assert(typeof row.roll === 'string' && (state.settings.rollPattern ? new RegExp(state.settings.rollPattern).test(row.roll) : /^ENG-\d{2}-CSE-\d{4}$/.test(row.roll)), 'Roll number does not match this cohort’s configured format.');
                assert(!rolls.has(row.roll), `Duplicate roll number: ${row.roll}. No records were imported.`);
                rolls.add(row.roll);
                assert(row.programme === state.settings.programme && Number(row.year) === (state.settings.year ?? 2), 'The programme and year must match this cohort.');
                const due = Number(row.due || 0);
                assert(Number.isFinite(due) && due >= 0 && due <= 1000000, 'Fee due is invalid.');
                const student: Student = { id: crypto.randomUUID(), name: row.name.trim(), roll: row.roll, year: state.settings.year ?? 2, section: state.settings.section ?? 'A', category: 'General', baseline: null, openingDue: Math.round(due * 100), synthetic: true };
                state.students.push(student);
                for (const batch of Object.values(state.marks)) {
                    assert(batch.status === 'Draft', 'Return/reopen all mark batches before changing the roster.');
                    batch.rows[student.id] = { test: null, assignment: null, practical: null };
                    batch.version++;
                }
            }
            detail = `${p.students.length} demo students imported into B.Tech CSE, year 2, section A`;
            break;
        }
        case 'subjects.add': {
            admin();
            for (const key of ['name', 'code', 'faculty', 'room', 'time'])
                assert(typeof p[key] === 'string' && p[key].trim().length >= 2 && p[key].length < 100, `${key} is required.`);
            assert(!state.subjects.some(s => s.code.toLowerCase() === p.code.toLowerCase()), 'This subject code already exists.');
            assert(Number.isInteger(p.period) && p.period >= 1 && p.period <= 8, 'Period must be 1–8.');
            const id = crypto.randomUUID();
            state.subjects.push({ id, code: p.code.trim(), name: p.name.trim(), faculty: p.faculty.trim(), room: p.room.trim(), time: p.time.trim(), period: p.period });
            state.marks[id] = { status: 'Draft', version: 0, rows: Object.fromEntries(state.students.map(s => [s.id, { test: null, assignment: null, practical: null }])) };
            detail = `Added ${p.code}: ${p.name}`;
            break;
        }
        default: detail = applyERPCommand(state, command, role, now, actor);
    }
    state.operations.push(command.id);
    state.audit.unshift({ id: command.id, at: now, actor: actor.displayName ?? (role === 'admin' ? 'Office admin' : facultyName), actorUserId: actor.userId, action: command.type, detail });
    return state;
}
