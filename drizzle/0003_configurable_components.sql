CREATE TABLE mark_entries_v2 (
  workspace_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  test INTEGER CHECK (test BETWEEN -1 AND 40),
  assignment INTEGER CHECK (assignment BETWEEN -1 AND 40),
  practical INTEGER CHECK (practical BETWEEN -1 AND 40),
  PRIMARY KEY (workspace_id,subject_id,student_id),
  FOREIGN KEY (workspace_id,subject_id) REFERENCES mark_batches(workspace_id,subject_id),
  FOREIGN KEY (workspace_id,student_id) REFERENCES campus_students(workspace_id,id)
);
--> statement-breakpoint
INSERT INTO mark_entries_v2 SELECT * FROM mark_entries;
--> statement-breakpoint
DROP TABLE mark_entries;
--> statement-breakpoint
ALTER TABLE mark_entries_v2 RENAME TO mark_entries;
