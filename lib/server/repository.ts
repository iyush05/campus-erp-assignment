import type { Workspace, WorkspaceAccess, WorkspaceResponse, StaffMember, Command, Role } from '../types.ts';
import { createSeed } from '../seed.ts';
import { applyCommand, DomainError, scopeState } from '../domain.ts';
import { query, statement, type Database, type Statement, type SqlValue } from './database.ts';

type Table = { name: string; columns: string[]; keys: number; immutable?: boolean };
const membersSQL = `SELECT workspace_id,user_id,display_name,role,active,version,created_at,NULL AS student_ids FROM staff_members UNION ALL SELECT workspace_id,user_id,display_name,role,active,version,created_at,student_ids FROM portal_members`;
const tables: Table[] = [
  { name: 'erp_records', columns: ['id','kind','version','created_at','updated_at','created_by','data_json'], keys: 1 },
  { name: 'campus_students', columns: ['id','name','roll','year','section','category','baseline_held','baseline_present','legacy_attendance','opening_due','synthetic'], keys: 1 },
  { name: 'campus_subjects', columns: ['id','code','name','faculty','room','time','period'], keys: 1 },
  { name: 'attendance_sessions', columns: ['id','subject_id','class_date','period','version','updated_at'], keys: 1 },
  { name: 'attendance_entries', columns: ['session_id','student_id','present'], keys: 2 },
  { name: 'mark_batches', columns: ['subject_id','status','version'], keys: 1 },
  { name: 'mark_entries', columns: ['subject_id','student_id','test','assignment','practical'], keys: 2 },
  { name: 'fee_payments', columns: ['id','student_id','amount','recorded_at','receipt'], keys: 1, immutable: true },
  { name: 'mentor_tasks', columns: ['id','student_id','reason','evidence','status','mentor','mentor_user_id','created_at'], keys: 1 },
  { name: 'audit_events', columns: ['id','occurred_at','actor','actor_user_id','action','detail'], keys: 1, immutable: true },
];
function records(state: Workspace): Record<string, SqlValue[][]> {
  return {
    erp_records: (state.erp?.records ?? []).map(r => [r.id,r.kind,r.version,r.createdAt,r.updatedAt,r.createdBy,JSON.stringify(r.data)]),
    campus_students: state.students.map(s => [s.id,s.name,s.roll,s.year,s.section,s.category,s.baseline?.held ?? null,s.baseline?.present ?? null,s.legacyAttendance ?? null,s.openingDue,Number(s.synthetic)]),
    campus_subjects: state.subjects.map(s => [s.id,s.code,s.name,s.faculty,s.room,s.time,s.period]),
    attendance_sessions: Object.values(state.attendance).map(a => [a.id,a.subjectId,a.date,a.period,a.version,a.updatedAt]),
    attendance_entries: Object.values(state.attendance).flatMap(a => Object.entries(a.entries).map(([student,present]) => [a.id,student,Number(present)])),
    mark_batches: Object.entries(state.marks).map(([id,b]) => [id,b.status,b.version]),
    mark_entries: Object.entries(state.marks).flatMap(([subject,b]) => Object.entries(b.rows).map(([student,m]) => [subject,student,m.test,m.assignment,m.practical])),
    fee_payments: state.payments.map(p => [p.id,p.studentId,p.amount,p.at,p.receipt]),
    mentor_tasks: state.tasks.map(t => [t.id,t.studentId,t.reason,t.evidence,t.status,t.mentor,t.mentorUserId ?? null,t.at]),
    audit_events: state.audit.map(a => [a.id,a.at,a.actor,a.actorUserId ?? null,a.action,a.detail]),
  };
}
const tokenGuard = 'EXISTS (SELECT 1 FROM campus_workspaces WHERE id = ? AND commit_token = ?)';
function putRows(table: Table, workspace: string, token: string, rows: SqlValue[][]): Statement[] {
  if (!rows.length) return [];
  const columns = ['workspace_id', ...table.columns];
  const values = table.columns.map((_, i) => `json_extract(value,'$[${i}]')`).join(',');
  const update = table.immutable ? 'NOTHING' : `UPDATE SET ${table.columns.slice(table.keys).map(c => `${c}=excluded.${c}`).join(',')}`;
  return [statement(`INSERT INTO ${table.name} (${columns.join(',')}) SELECT ?,${values} FROM json_each(?) WHERE ${tokenGuard} ON CONFLICT (${columns.slice(0,table.keys + 1).join(',')}) DO ${update}`, workspace, JSON.stringify(rows), workspace, token)];
}
function changedRows(before: Workspace | null, after: Workspace, workspace: string, token: string): Statement[] {
  const old = before ? records(before) : {}, next = records(after);
  return tables.flatMap(table => {
    const existing = new Map((old[table.name] ?? []).map(row => [JSON.stringify(row.slice(0,table.keys)),JSON.stringify(row)]));
    return putRows(table,workspace,token,next[table.name].filter(row => existing.get(JSON.stringify(row.slice(0,table.keys))) !== JSON.stringify(row)));
  });
}
export async function bootstrapWorkspace(db: Database, owner: { userId: string; displayName: string }, workspaceId = 'engineering-cse', config?: {name:string;campusId:string;departmentId:string;programme:string;year:number;section:string;batch:string}) {
  if ((await query(db, 'SELECT id FROM campus_workspaces WHERE id = ?', workspaceId)).length) return;
  const legacy = config ? undefined : (await query(db, 'SELECT data FROM workspaces WHERE owner_id = ?', owner.userId))[0];
  const seed: Workspace = legacy ? JSON.parse(legacy.data) : createSeed();
  if (config) { seed.students=[];seed.subjects=[];seed.marks={};seed.settings={...seed.settings,programme:config.programme,year:config.year,section:config.section,batch:config.batch,rollPattern:'^[A-Za-z0-9_-]{3,40}$'}; }
  // Retain original records and operation IDs; identify legacy audit/task owners.
  seed.audit = seed.audit.map(a => ({ ...a, actorUserId: a.actorUserId ?? owner.userId }));
  seed.tasks = seed.tasks.map(t => ({ ...t, mentorUserId: t.mentorUserId ?? owner.userId }));
  const token = crypto.randomUUID(), now = new Date().toISOString();
  await db.batch([
    statement('INSERT OR IGNORE INTO campus_workspaces (id,name,campus_id,department_id,settings_json,revision,commit_token,migrated_from,created_at) VALUES (?,?,?,?,?,0,?,?,?)',workspaceId,config?.name ?? 'Engineering campus · CSE',config?.campusId ?? 'engineering',config?.departmentId ?? 'cse',JSON.stringify(seed.settings),token,legacy ? owner.userId : null,now),
    statement(`INSERT INTO staff_members (workspace_id,user_id,display_name,role,active,version,created_at) SELECT ?,?,?,'admin',1,1,? WHERE ${tokenGuard} ON CONFLICT DO NOTHING`,workspaceId,owner.userId,owner.displayName,now,workspaceId,token),
    ...changedRows(null,seed,workspaceId,token),
    statement(`INSERT INTO processed_operations (workspace_id,id,actor_user_id,fingerprint) SELECT ?,value,?,'legacy' FROM json_each(?) WHERE ${tokenGuard} ON CONFLICT DO NOTHING`,workspaceId,owner.userId,JSON.stringify(seed.operations),workspaceId,token),
  ]);
}
export async function listWorkspaces(db: Database, userId: string) {
  const rows = await query(db, `SELECT w.id,w.name,m.role FROM campus_workspaces w JOIN (${membersSQL}) m ON m.workspace_id=w.id WHERE m.user_id=? AND m.active=1 ORDER BY w.created_at,w.id`,userId);
  return rows as { id: string; name: string; role: Role }[];
}
export async function readSnapshot(db: Database, userId: string, requested?: string) {
  const available = await listWorkspaces(db,userId);
  const workspaceId = requested || available[0]?.id;
  if (!workspaceId || !available.some(w => w.id === workspaceId)) throw new DomainError('Your account has no active access to this campus and department. Ask an office admin to provision your account.',403);
  const results = await db.batch([
    statement('SELECT * FROM campus_workspaces WHERE id=?',workspaceId),
    statement(`SELECT * FROM (${membersSQL}) WHERE workspace_id=?`,workspaceId),
    statement('SELECT * FROM faculty_assignments WHERE workspace_id=?',workspaceId),
    ...tables.map(t => statement(`SELECT * FROM ${t.name} WHERE workspace_id=?`,workspaceId)),
    statement('SELECT * FROM processed_operations WHERE workspace_id=?',workspaceId),
  ]);
  const workspace = results[0].rows[0], members = results[1].rows, assignments = results[2].rows;
  const member = members.find(m => m.user_id === userId && m.active === 1);
  if (!workspace || !member) throw new DomainError('Your campus access was revoked. Unsynced records remain on this device for review.',403);
  const rows = Object.fromEntries(tables.map((t,i) => [t.name,results[i+3].rows]));
  const state: Workspace = {
    erp: {records: rows.erp_records.map(r => ({id:r.id,kind:r.kind,version:r.version,createdAt:r.created_at,updatedAt:r.updated_at,createdBy:r.created_by,data:JSON.parse(r.data_json)}))},
    settings: JSON.parse(workspace.settings_json),
    students: rows.campus_students.map(s => ({ id:s.id,name:s.name,roll:s.roll,year:s.year,section:s.section,category:s.category,baseline:s.baseline_held === null ? null : {held:s.baseline_held,present:s.baseline_present},...(s.legacy_attendance === null ? {} : {legacyAttendance:s.legacy_attendance}),openingDue:s.opening_due,synthetic:!!s.synthetic })),
    subjects: rows.campus_subjects.map(s => ({id:s.id,code:s.code,name:s.name,faculty:s.faculty,room:s.room,time:s.time,period:s.period})),
    attendance: Object.fromEntries(rows.attendance_sessions.map(a => [a.id,{id:a.id,subjectId:a.subject_id,date:a.class_date,period:a.period,version:a.version,updatedAt:a.updated_at,entries:{}}])),
    marks: Object.fromEntries(rows.mark_batches.map(b => [b.subject_id,{status:b.status,version:b.version,rows:{}}])),
    payments: rows.fee_payments.map(p => ({id:p.id,studentId:p.student_id,amount:p.amount,at:p.recorded_at,receipt:p.receipt})).sort((a,b) => a.receipt.localeCompare(b.receipt)),
    tasks: rows.mentor_tasks.map(t => ({id:t.id,studentId:t.student_id,reason:t.reason,evidence:t.evidence,status:t.status,mentor:t.mentor,...(t.mentor_user_id ? {mentorUserId:t.mentor_user_id} : {}),at:t.created_at})),
    audit: rows.audit_events.map(a => ({id:a.id,at:a.occurred_at,actor:a.actor,...(a.actor_user_id ? {actorUserId:a.actor_user_id} : {}),action:a.action,detail:a.detail})).sort((a,b) => b.at.localeCompare(a.at)),
    operations: results.at(-1)!.rows.map(o => o.id),
  };
  for (const a of rows.attendance_entries) state.attendance[a.session_id].entries[a.student_id] = !!a.present;
  for (const m of rows.mark_entries) state.marks[m.subject_id].rows[m.student_id] = {test:m.test,assignment:m.assignment,practical:m.practical};
  const staff: StaffMember[] = members.map(m => ({userId:m.user_id,displayName:m.display_name,role:m.role,active:!!m.active,version:m.version,studentIds:m.student_ids ? JSON.parse(m.student_ids) : [],subjectIds:assignments.filter(a => a.user_id === m.user_id).map(a => a.subject_id)}));
  const current = staff.find(m => m.userId === userId)!;
  const access: WorkspaceAccess = {workspaceId,campusId:workspace.campus_id,departmentId:workspace.department_id,name:workspace.name,userId,displayName:current.displayName,role:current.role,version:current.version,subjectIds:current.subjectIds,studentIds:current.studentIds};
  return {state,revision:workspace.revision as number,access,staff,available,processed:results.at(-1)!.rows};
}
type Snapshot = Awaited<ReturnType<typeof readSnapshot>>;
export function publicResponse(snapshot: Snapshot): WorkspaceResponse {
  const {access,state,revision,staff,available} = snapshot;
  return {state:scopeState(state,access.role,access),revision,owner:access.userId,access,staff:access.role === 'admin' ? staff : [],workspaces:available};
}
async function fingerprint(command: Command) {
  const canonical = (value: any): any => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(k => [k,canonical(value[k])])) : value;
  const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(command))));
  return Array.from(new Uint8Array(hash),n => n.toString(16).padStart(2,'0')).join('');
}
function validateStaff(snapshot: Snapshot, command: Command) {
  if (snapshot.access.role !== 'admin') throw new DomainError('Only office admins can manage staff access.',403);
  const p = command.payload;
  if (typeof p.userId !== 'string' || !/^[A-Za-z0-9_.:@-]{3,200}$/.test(p.userId)) throw new DomainError('Provide the exact signed-in account ID.');
  if (typeof p.displayName !== 'string' || p.displayName.trim().length < 2 || p.displayName.length > 100) throw new DomainError('A staff display name is required.');
  if (!['admin','faculty','student','parent'].includes(p.role) || typeof p.active !== 'boolean') throw new DomainError('Choose a valid role and access state.');
  if (!Array.isArray(p.subjectIds) || p.subjectIds.some((id: unknown) => typeof id !== 'string' || !snapshot.state.subjects.some(s => s.id === id))) throw new DomainError('Assignments must refer to subjects in this campus and department.');
  if (['student','parent'].includes(p.role) && (!Array.isArray(p.studentIds) || !p.studentIds.length || (p.role === 'student' && p.studentIds.length !== 1) || p.studentIds.some((id: unknown) => !snapshot.state.students.some(st => st.id === id)))) throw new DomainError('Link one enrolled student for a student account, or one or more for a parent account.');
  const previous = snapshot.staff.find(m => m.userId === p.userId);
  if ((previous?.version ?? 0) !== p.baseVersion) throw new DomainError('This staff member was updated elsewhere. Refresh before saving.',409);
  if (p.userId === snapshot.access.userId && (p.role !== snapshot.access.role || !p.active)) throw new DomainError('Another admin must change your own role or revoke your access.');
  if (previous?.active && previous.role === 'admin' && (!p.active || p.role !== 'admin') && snapshot.staff.filter(m => m.active && m.role === 'admin').length === 1) throw new DomainError('Keep at least one active office admin.');
  return { userId:p.userId,displayName:p.displayName.trim(),role:p.role,active:p.active,version:(previous?.version ?? 0)+1,subjectIds:p.role === 'faculty' ? [...new Set(p.subjectIds)] as string[] : [],studentIds:['student','parent'].includes(p.role) ? [...new Set(p.studentIds)] as string[] : [] } as StaffMember;
}
export async function executeCommand(db: Database, userId: string, workspaceId: string | undefined, command: Command) {
  if (!workspaceId) throw new DomainError('A campus workspace ID is required for every change.',400);
  if (!command || typeof command.id !== 'string' || command.id.length < 8 || command.id.length > 100 || !command.payload || typeof command.payload !== 'object') throw new DomainError('Invalid operation.');
  const hash = await fingerprint(command);
  for (let attempt=0; attempt<4; attempt++) {
    const snapshot = await readSnapshot(db,userId,workspaceId), {access,state} = snapshot;
    if (command.type === 'risk.record' && command.payload.sourceRevision !== snapshot.revision) throw new DomainError('Data changed during analysis. Run it again.',409);
    const existing = snapshot.processed.find(op => op.id === command.id);
    if (existing) {
      if (existing.actor_user_id !== userId || (existing.fingerprint !== hash && existing.fingerprint !== 'legacy')) throw new DomainError('This operation ID belongs to a different request. Refresh before trying again.',409);
      return publicResponse(snapshot);
    }
    const now = new Date().toISOString(), token = crypto.randomUUID();
    let next: Workspace, staffChange: StaffMember | undefined;
    if (command.type === 'staff.save') {
      staffChange = validateStaff(snapshot,command); next = structuredClone(state);
      next.audit.unshift({id:command.id,at:now,actor:access.displayName,actorUserId:userId,action:'staff.save',detail:JSON.stringify({before:snapshot.staff.find(m => m.userId === staffChange!.userId) ?? null,after:staffChange})});
    } else {
      next = applyCommand(state,command,access.role,now,access);
    }
    const writes: Statement[] = [statement(`UPDATE campus_workspaces SET revision=revision+1,commit_token=?,settings_json=? WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM (${membersSQL}) WHERE workspace_id=? AND user_id=? AND active=1 AND version=?)`,token,JSON.stringify(next.settings),workspaceId,snapshot.revision,workspaceId,userId,access.version),...changedRows(state,next,workspaceId,token)];
    if (staffChange) {
      const m = staffChange;
      writes.push(statement(`DELETE FROM faculty_assignments WHERE workspace_id=? AND user_id=? AND ${tokenGuard}`,workspaceId,m.userId,workspaceId,token));
      if (m.role === 'student' || m.role === 'parent') {
        writes.push(statement(`DELETE FROM staff_members WHERE workspace_id=? AND user_id=? AND ${tokenGuard}`,workspaceId,m.userId,workspaceId,token));
        writes.push(statement(`INSERT INTO portal_members (workspace_id,user_id,display_name,role,active,version,student_ids,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${tokenGuard} ON CONFLICT (workspace_id,user_id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,active=excluded.active,version=excluded.version,student_ids=excluded.student_ids`,workspaceId,m.userId,m.displayName,m.role,Number(m.active),m.version,JSON.stringify(m.studentIds),now,workspaceId,token));
      } else {
        writes.push(statement(`DELETE FROM portal_members WHERE workspace_id=? AND user_id=? AND ${tokenGuard}`,workspaceId,m.userId,workspaceId,token));
        writes.push(statement(`INSERT INTO staff_members (workspace_id,user_id,display_name,role,active,version,created_at) SELECT ?,?,?,?,?,?,? WHERE ${tokenGuard} ON CONFLICT (workspace_id,user_id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,active=excluded.active,version=excluded.version`,workspaceId,m.userId,m.displayName,m.role,Number(m.active),m.version,now,workspaceId,token));
        if (m.subjectIds.length) writes.push(statement(`INSERT INTO faculty_assignments (workspace_id,user_id,subject_id) SELECT ?,?,value FROM json_each(?) WHERE ${tokenGuard}`,workspaceId,m.userId,JSON.stringify(m.subjectIds),workspaceId,token));
      }
    }
    writes.push(statement(`INSERT INTO processed_operations (workspace_id,id,actor_user_id,fingerprint) SELECT ?,?,?,? WHERE ${tokenGuard}`,workspaceId,command.id,userId,hash,workspaceId,token));
    const result = await db.batch(writes);
    if (result[0].changes === 1) return publicResponse(await readSnapshot(db,userId,workspaceId));
  }
  throw new DomainError('Another update is in progress. Refresh and retry; no partial changes were saved.',409);
}
