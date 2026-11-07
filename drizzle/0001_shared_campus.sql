CREATE TABLE campus_workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  campus_id TEXT NOT NULL,
  department_id TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  commit_token TEXT NOT NULL,
  migrated_from TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE staff_members (
  workspace_id TEXT NOT NULL REFERENCES campus_workspaces(id),
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','faculty')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id,user_id)
);
--> statement-breakpoint
CREATE INDEX staff_user_lookup ON staff_members(user_id,active);
--> statement-breakpoint
CREATE TABLE campus_students (
  workspace_id TEXT NOT NULL REFERENCES campus_workspaces(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  roll TEXT NOT NULL,
  year INTEGER NOT NULL,
  section TEXT NOT NULL,
  category TEXT NOT NULL,
  baseline_held INTEGER,
  baseline_present INTEGER,
  legacy_attendance REAL,
  opening_due INTEGER NOT NULL CHECK (opening_due >= 0),
  synthetic INTEGER NOT NULL,
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,roll)
);
--> statement-breakpoint
CREATE TABLE campus_subjects (
  workspace_id TEXT NOT NULL REFERENCES campus_workspaces(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  faculty TEXT NOT NULL,
  room TEXT NOT NULL,
  time TEXT NOT NULL,
  period INTEGER NOT NULL CHECK (period BETWEEN 1 AND 8),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,code)
);
--> statement-breakpoint
CREATE TABLE faculty_assignments (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id,user_id,subject_id),
  FOREIGN KEY (workspace_id,user_id) REFERENCES staff_members(workspace_id,user_id),
  FOREIGN KEY (workspace_id,subject_id) REFERENCES campus_subjects(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE attendance_sessions (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  class_date TEXT NOT NULL,
  period INTEGER NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,subject_id,class_date,period),
  FOREIGN KEY (workspace_id,subject_id) REFERENCES campus_subjects(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE attendance_entries (
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  present INTEGER NOT NULL CHECK (present IN (0,1)),
  PRIMARY KEY (workspace_id,session_id,student_id),
  FOREIGN KEY (workspace_id,session_id) REFERENCES attendance_sessions(workspace_id,id),
  FOREIGN KEY (workspace_id,student_id) REFERENCES campus_students(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE mark_batches (
  workspace_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Draft','Submitted','Locked')),
  version INTEGER NOT NULL,
  PRIMARY KEY (workspace_id,subject_id),
  FOREIGN KEY (workspace_id,subject_id) REFERENCES campus_subjects(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE mark_entries (
  workspace_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  test INTEGER CHECK (test BETWEEN 0 AND 20),
  assignment INTEGER CHECK (assignment BETWEEN 0 AND 10),
  practical INTEGER CHECK (practical BETWEEN 0 AND 10),
  PRIMARY KEY (workspace_id,subject_id,student_id),
  FOREIGN KEY (workspace_id,subject_id) REFERENCES mark_batches(workspace_id,subject_id),
  FOREIGN KEY (workspace_id,student_id) REFERENCES campus_students(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE fee_payments (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  recorded_at TEXT NOT NULL,
  receipt TEXT NOT NULL,
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,receipt),
  FOREIGN KEY (workspace_id,student_id) REFERENCES campus_students(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE mentor_tasks (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence TEXT NOT NULL,
  status TEXT NOT NULL,
  mentor TEXT NOT NULL,
  mentor_user_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id,id),
  FOREIGN KEY (workspace_id,student_id) REFERENCES campus_students(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE audit_events (
  workspace_id TEXT NOT NULL REFERENCES campus_workspaces(id),
  id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  PRIMARY KEY (workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE processed_operations (
  workspace_id TEXT NOT NULL REFERENCES campus_workspaces(id),
  id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (workspace_id,id)
);
