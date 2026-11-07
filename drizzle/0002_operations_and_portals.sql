CREATE TABLE erp_records (
  workspace_id TEXT NOT NULL REFERENCES campus_workspaces(id),
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (workspace_id,id)
);
--> statement-breakpoint
CREATE INDEX erp_record_kind ON erp_records(workspace_id,kind);
--> statement-breakpoint
CREATE TABLE portal_members (
  workspace_id TEXT NOT NULL REFERENCES campus_workspaces(id),
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','parent')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  student_ids TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id,user_id)
);
--> statement-breakpoint
CREATE INDEX portal_user_lookup ON portal_members(user_id,active);
--> statement-breakpoint
CREATE TABLE local_documents (
  object_key TEXT PRIMARY KEY NOT NULL,
  content_type TEXT NOT NULL,
  content_base64 TEXT NOT NULL
);
