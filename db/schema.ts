import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, primaryKey, foreignKey, unique, index, check } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('workspaces', {
  owner_id: text('owner_id').primaryKey().notNull(),
  revision: integer('revision').notNull().default(0),
  data: text('data').notNull(),
  updated_at: text('updated_at').notNull(),
}, (t) => [
]);

export const campus_workspaces = sqliteTable('campus_workspaces', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  campus_id: text('campus_id').notNull(),
  department_id: text('department_id').notNull(),
  settings_json: text('settings_json').notNull(),
  revision: integer('revision').notNull().default(0),
  commit_token: text('commit_token').notNull(),
  migrated_from: text('migrated_from'),
  created_at: text('created_at').notNull(),
}, (t) => [
]);

export const staff_members = sqliteTable('staff_members', {
  workspace_id: text('workspace_id').notNull(),
  user_id: text('user_id').notNull(),
  display_name: text('display_name').notNull(),
  role: text('role').notNull(),
  active: integer('active').notNull().default(1),
  version: integer('version').notNull().default(1),
  created_at: text('created_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.workspace_id, t.user_id], name: 'staff_members_workspace_id_user_id_pk' }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [campus_workspaces.id], name: 'staff_members_workspace_id_campus_workspaces_id_fk' }),
  index('staff_user_lookup').on(t.user_id, t.active),
  check('staff_members_role_check', sql`role IN ('admin','faculty')`),
  check('staff_members_active_check', sql`active IN (0,1)`),
]);

export const campus_students = sqliteTable('campus_students', {
  workspace_id: text('workspace_id').notNull(),
  id: text('id').notNull(),
  name: text('name').notNull(),
  roll: text('roll').notNull(),
  year: integer('year').notNull(),
  section: text('section').notNull(),
  category: text('category').notNull(),
  baseline_held: integer('baseline_held'),
  baseline_present: integer('baseline_present'),
  legacy_attendance: real('legacy_attendance'),
  opening_due: integer('opening_due').notNull(),
  synthetic: integer('synthetic').notNull(),
}, (t) => [
  primaryKey({ columns: [t.workspace_id, t.id], name: 'campus_students_workspace_id_id_pk' }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [campus_workspaces.id], name: 'campus_students_workspace_id_campus_workspaces_id_fk' }),
  unique('campus_students_workspace_id_roll_unique').on(t.workspace_id, t.roll),
  check('campus_students_opening_due_check', sql`opening_due >= 0`),
]);

export const campus_subjects = sqliteTable('campus_subjects', {
  workspace_id: text('workspace_id').notNull(),
  id: text('id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  faculty: text('faculty').notNull(),
  room: text('room').notNull(),
  time: text('time').notNull(),
  period: integer('period').notNull(),
}, (t) => [
  primaryKey({ columns: [t.workspace_id, t.id], name: 'campus_subjects_workspace_id_id_pk' }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [campus_workspaces.id], name: 'campus_subjects_workspace_id_campus_workspaces_id_fk' }),
  unique('campus_subjects_workspace_id_code_unique').on(t.workspace_id, t.code),
  check('campus_subjects_period_check', sql`period BETWEEN 1 AND 8`),
]);

export const faculty_assignments = sqliteTable('faculty_assignments', {
  workspace_id: text('workspace_id').notNull(),
  user_id: text('user_id').notNull(),
  subject_id: text('subject_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.workspace_id, t.user_id, t.subject_id], name: 'faculty_assignments_workspace_id_user_id_subject_id_pk' }),
  foreignKey({ columns: [t.workspace_id, t.subject_id], foreignColumns: [campus_subjects.workspace_id, campus_subjects.id], name: 'faculty_assignments_workspace_id_subject_id_campus_subjects_workspace_id_id_fk' }),
  foreignKey({ columns: [t.workspace_id, t.user_id], foreignColumns: [staff_members.workspace_id, staff_members.user_id], name: 'faculty_assignments_workspace_id_user_id_staff_members_workspace_id_user_id_fk' }),
]);

export const attendance_sessions = sqliteTable('attendance_sessions', {
  workspace_id: text('workspace_id').notNull(),
  id: text('id').notNull(),
  subject_id: text('subject_id').notNull(),
  class_date: text('class_date').notNull(),
  period: integer('period').notNull(),
  version: integer('version').notNull(),
  updated_at: text('updated_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.workspace_id, t.id], name: 'attendance_sessions_workspace_id_id_pk' }),
  foreignKey({ columns: [t.workspace_id, t.subject_id], foreignColumns: [campus_subjects.workspace_id, campus_subjects.id], name: 'attendance_sessions_workspace_id_subject_id_campus_subjects_workspace_id_id_fk' }),
  unique('attendance_sessions_workspace_id_subject_id_class_date_period_unique').on(t.workspace_id, t.subject_id, t.class_date, t.period),
]);

export const attendance_entries = sqliteTable('attendance_entries', {
  workspace_id: text('workspace_id').notNull(),
  session_id: text('session_id').notNull(),
  student_id: text('student_id').notNull(),
  present: integer('present').notNull(),
}, (t) => [
  primaryKey({ columns: [t.workspace_id, t.session_id, t.student_id], name: 'attendance_entries_workspace_id_session_id_student_id_pk' }),
  foreignKey({ columns: [t.workspace_id, t.student_id], foreignColumns: [campus_students.workspace_id, campus_students.id], name: 'attendance_entries_workspace_id_student_id_campus_students_workspace_id_id_fk' }),
  foreignKey({ columns: [t.workspace_id, t.session_id], foreignColumns: [attendance_sessions.workspace_id, attendance_sessions.id], name: 'attendance_entries_workspace_id_session_id_attendance_sessions_workspace_id_id_fk' }),
  check('attendance_entries_present_check', sql`present IN (0,1)`),
]);

export const mark_batches = sqliteTable('mark_batches', {
  workspace_id: text('workspace_id').notNull(),
  subject_id: text('subject_id').notNull(),
  status: text('status').notNull(),
  version: integer('version').notNull(),
}, (t) => [
  primaryKey({ columns: [t.workspace_id, t.subject_id], name: 'mark_batches_workspace_id_subject_id_pk' }),
  foreignKey({ columns: [t.workspace_id, t.subject_id], foreignColumns: [campus_subjects.workspace_id, campus_subjects.id], name: 'mark_batches_workspace_id_subject_id_campus_subjects_workspace_id_id_fk' }),
  check('mark_batches_status_check', sql`status IN ('Draft','Submitted','Locked')`),
]);

export const fee_payments = sqliteTable('fee_payments', {
  workspace_id: text('workspace_id').notNull(),
  id: text('id').notNull(),
  student_id: text('student_id').notNull(),
  amount: integer('amount').notNull(),
  recorded_at: text('recorded_at').notNull(),
  receipt: text('receipt').notNull(),
}, (t) => [
  primaryKey({ columns: [t.workspace_id, t.id], name: 'fee_payments_workspace_id_id_pk' }),
  foreignKey({ columns: [t.workspace_id, t.student_id], foreignColumns: [campus_students.workspace_id, campus_students.id], name: 'fee_payments_workspace_id_student_id_campus_students_workspace_id_id_fk' }),
  unique('fee_payments_workspace_id_receipt_unique').on(t.workspace_id, t.receipt),
  check('fee_payments_amount_check', sql`amount > 0`),
]);

export const mentor_tasks = sqliteTable('mentor_tasks', {
  workspace_id: text('workspace_id').notNull(),
  id: text('id').notNull(),
  student_id: text('student_id').notNull(),
  reason: text('reason').notNull(),
  evidence: text('evidence').notNull(),
  status: text('status').notNull(),
  mentor: text('mentor').notNull(),
  mentor_user_id: text('mentor_user_id'),
  created_at: text('created_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.workspace_id, t.id], name: 'mentor_tasks_workspace_id_id_pk' }),
  foreignKey({ columns: [t.workspace_id, t.student_id], foreignColumns: [campus_students.workspace_id, campus_students.id], name: 'mentor_tasks_workspace_id_student_id_campus_students_workspace_id_id_fk' }),
]);

export const audit_events = sqliteTable('audit_events', {
  workspace_id: text('workspace_id').notNull(),
  id: text('id').notNull(),
  occurred_at: text('occurred_at').notNull(),
  actor: text('actor').notNull(),
  actor_user_id: text('actor_user_id'),
  action: text('action').notNull(),
  detail: text('detail').notNull(),
}, (t) => [
  primaryKey({ columns: [t.workspace_id, t.id], name: 'audit_events_workspace_id_id_pk' }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [campus_workspaces.id], name: 'audit_events_workspace_id_campus_workspaces_id_fk' }),
]);

export const processed_operations = sqliteTable('processed_operations', {
  workspace_id: text('workspace_id').notNull(),
  id: text('id').notNull(),
  actor_user_id: text('actor_user_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
}, (t) => [
  primaryKey({ columns: [t.workspace_id, t.id], name: 'processed_operations_workspace_id_id_pk' }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [campus_workspaces.id], name: 'processed_operations_workspace_id_campus_workspaces_id_fk' }),
]);

export const erp_records = sqliteTable('erp_records', {
  workspace_id: text('workspace_id').notNull(),
  id: text('id').notNull(),
  kind: text('kind').notNull(),
  version: integer('version').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  created_by: text('created_by').notNull(),
  data_json: text('data_json').notNull(),
}, (t) => [
  primaryKey({ columns: [t.workspace_id, t.id], name: 'erp_records_workspace_id_id_pk' }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [campus_workspaces.id], name: 'erp_records_workspace_id_campus_workspaces_id_fk' }),
  index('erp_record_kind').on(t.workspace_id, t.kind),
]);

export const portal_members = sqliteTable('portal_members', {
  workspace_id: text('workspace_id').notNull(),
  user_id: text('user_id').notNull(),
  display_name: text('display_name').notNull(),
  role: text('role').notNull(),
  active: integer('active').notNull().default(1),
  version: integer('version').notNull().default(1),
  student_ids: text('student_ids').notNull(),
  created_at: text('created_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.workspace_id, t.user_id], name: 'portal_members_workspace_id_user_id_pk' }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [campus_workspaces.id], name: 'portal_members_workspace_id_campus_workspaces_id_fk' }),
  index('portal_user_lookup').on(t.user_id, t.active),
  check('portal_members_role_check', sql`role IN ('student','parent')`),
  check('portal_members_active_check', sql`active IN (0,1)`),
]);

export const local_documents = sqliteTable('local_documents', {
  object_key: text('object_key').primaryKey().notNull(),
  content_type: text('content_type').notNull(),
  content_base64: text('content_base64').notNull(),
}, (t) => [
]);

export const mark_entries = sqliteTable('mark_entries', {
  workspace_id: text('workspace_id').notNull(),
  subject_id: text('subject_id').notNull(),
  student_id: text('student_id').notNull(),
  test: integer('test'),
  assignment: integer('assignment'),
  practical: integer('practical'),
}, (t) => [
  primaryKey({ columns: [t.workspace_id, t.subject_id, t.student_id], name: 'mark_entries_workspace_id_subject_id_student_id_pk' }),
  foreignKey({ columns: [t.workspace_id, t.student_id], foreignColumns: [campus_students.workspace_id, campus_students.id], name: 'mark_entries_workspace_id_student_id_campus_students_workspace_id_id_fk' }),
  foreignKey({ columns: [t.workspace_id, t.subject_id], foreignColumns: [mark_batches.workspace_id, mark_batches.subject_id], name: 'mark_entries_workspace_id_subject_id_mark_batches_workspace_id_subject_id_fk' }),
  check('mark_entries_test_check', sql`test BETWEEN -1 AND 40`),
  check('mark_entries_assignment_check', sql`assignment BETWEEN -1 AND 40`),
  check('mark_entries_practical_check', sql`practical BETWEEN -1 AND 40`),
]);
