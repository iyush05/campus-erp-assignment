'use client';
import { useState } from 'react';
import type { StaffMember } from '../../lib/types';
import type { WorkspaceController } from '../../lib/use-workspace';
import { Badge, Modal, SectionHead } from './ui';
import { roleName } from '../../lib/navigation';

export function StaffAccess({ c }: { c: WorkspaceController }) {
    const [editing, setEditing] = useState<StaffMember | null>(null), [error, setError] = useState('');
    const open = (member?: StaffMember) => {
        setError('');
        setEditing(member ? { ...member, subjectIds: [...member.subjectIds] } : { userId: '', displayName: '', role: 'faculty', active: true, version: 0, subjectIds: [], studentIds: [] });
    };
    return <section className="panel receipts-panel">
        <SectionHead title="Staff & portal access" subtitle="Staff subject assignments and linked student/parent accounts for this campus." action={<button className="button primary" disabled={c.cached || c.busy} onClick={() => open()}>Add account</button>} />
        <div className="info-note">Your account ID: <code>{c.owner}</code>. Ask colleagues to sign in and share their account ID, then assign their role and subjects here. Site visitor access must also allow them to open the hosted site.</div>
        <div className="table-scroll"><table><thead><tr><th>Account</th><th>Role</th><th>Subjects / linked students</th><th>Status</th><th /></tr></thead><tbody>
            {c.staff.map(member => <tr key={member.userId}><td><strong>{member.displayName}</strong><small className="cell-sub">{member.userId}</small></td><td>{roleName(member.role)}</td><td>{member.role === 'admin' ? 'All subjects' : member.role === 'faculty' ? member.subjectIds.map(id => c.state!.subjects.find(s => s.id === id)?.code).join(', ') || 'No assignments' : member.studentIds?.map(id => c.state!.students.find(s=>s.id===id)?.roll).join(', ')}</td><td><Badge tone={member.active ? 'green' : 'neutral'}>{member.active ? 'Active' : 'Revoked'}</Badge></td><td><button className="button small-button" disabled={c.cached || c.busy} onClick={() => open(member)}>Edit access</button></td></tr>)}
        </tbody></table></div>
        {editing && <Modal title={editing.version ? 'Edit staff access' : 'Add account'} onClose={() => setEditing(null)}>
            <form onSubmit={async e => {
                e.preventDefault();
                try {
                    await c.mutate('staff.save', { ...editing, baseVersion: editing.version }, 'Staff access saved');
                    setEditing(null);
                } catch (e) { setError((e as Error).message); }
            }}>
                <label className="field">Account ID<input required minLength={3} maxLength={200} value={editing.userId} disabled={editing.version > 0} onChange={e => setEditing({ ...editing, userId: e.target.value.trim() })} /></label>
                <label className="field">Display name<input required minLength={2} maxLength={100} value={editing.displayName} onChange={e => setEditing({ ...editing, displayName: e.target.value })} /></label>
                <label className="field">Role<select value={editing.role} disabled={editing.userId === c.owner} onChange={e => setEditing({ ...editing, role: e.target.value as StaffMember['role'] })}><option value="faculty">Teacher</option><option value="admin">Office admin</option><option value="student">Student</option><option value="parent">Parent</option></select></label>
                <label className="field">Access<select value={String(editing.active)} disabled={editing.userId === c.owner} onChange={e => setEditing({ ...editing, active: e.target.value === 'true' })}><option value="true">Active</option><option value="false">Revoked</option></select></label>
                {editing.role === 'faculty' && <fieldset><legend>Assigned subjects</legend>{c.state!.subjects.map(subject => <label className="detail-row" key={subject.id}><span>{subject.code} · {subject.name}</span><input type="checkbox" checked={editing.subjectIds.includes(subject.id)} onChange={e => setEditing({ ...editing, subjectIds: e.target.checked ? [...editing.subjectIds, subject.id] : editing.subjectIds.filter(id => id !== subject.id) })} /></label>)}</fieldset>}
                {(editing.role === 'student' || editing.role === 'parent') && <fieldset><legend>Linked students</legend>{c.state!.students.map(student => <label className="detail-row" key={student.id}><span>{student.roll} · {student.name}</span><input type="checkbox" checked={editing.studentIds?.includes(student.id) ?? false} onChange={e => setEditing({ ...editing, studentIds: e.target.checked ? editing.role === 'student' ? [student.id] : [...(editing.studentIds ?? []), student.id] : (editing.studentIds ?? []).filter(id => id !== student.id) })}/></label>)}</fieldset>}
                {error && <div className="form-error" role="alert">{error}</div>}
                <div className="modal-actions"><button type="button" className="button" onClick={() => setEditing(null)}>Cancel</button><button className="button primary" disabled={c.busy || c.cached}>Save access</button></div>
            </form>
        </Modal>}
    </section>;
}
