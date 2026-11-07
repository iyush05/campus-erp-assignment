import type { ERPState } from './erp-types';
export type Role = 'admin' | 'faculty' | 'student' | 'parent';
export type Student = {
    id: string;
    name: string;
    roll: string;
    year: number;
    section: string;
    category: string;
    baseline: {
        held: number;
        present: number;
    } | null;
    legacyAttendance?: number;
    openingDue: number;
    synthetic: boolean;
};
export type Subject = {
    id: string;
    code: string;
    name: string;
    faculty: string;
    room: string;
    time: string;
    period: number;
};
export type MarkRow = {
    test: number | null;
    assignment: number | null;
    practical: number | null;
};
export type MarkBatch = {
    status: 'Draft' | 'Submitted' | 'Locked';
    version: number;
    rows: Record<string, MarkRow>;
};
export type AttendanceSession = {
    id: string;
    subjectId: string;
    date: string;
    period: number;
    entries: Record<string, boolean>;
    version: number;
    updatedAt: string;
};
export type Payment = {
    id: string;
    studentId: string;
    amount: number;
    at: string;
    receipt: string;
};
export type Task = {
    id: string;
    studentId: string;
    reason: string;
    evidence: string;
    status: 'Open' | 'In progress' | 'Closed';
    mentor: string;
    mentorUserId?: string;
    at: string;
};
export type Audit = {
    id: string;
    at: string;
    actor: string;
    actorUserId?: string;
    action: string;
    detail: string;
};
export type Workspace = {
    erp?: ERPState;
    students: Student[];
    subjects: Subject[];
    attendance: Record<string, AttendanceSession>;
    marks: Record<string, MarkBatch>;
    payments: Payment[];
    tasks: Task[];
    audit: Audit[];
    operations: string[];
    settings: {
        configurationVersion?: number;
        year?: number;
        section?: string;
        rollPattern?: string;
        components?: { test: number; assignment: number; practical: number };
        programme: string;
        batch: string;
        semester: string;
        academicYear: string;
        attendanceThreshold: number;
    };
};
export type Command = {
    id: string;
    type: string;
    payload: Record<string, any>;
};
export type QueuedAttendance = {
    command: Command;
    owner: string;
    workspaceId?: string;
    role: Role;
    status: 'pending' | 'conflict' | 'rejected';
    error?: string;
};

export type StaffMember = {
    userId: string;
    displayName: string;
    role: Role;
    active: boolean;
    version: number;
    subjectIds: string[];
    studentIds?: string[];
};
export type WorkspaceAccess = {
    workspaceId: string;
    campusId: string;
    departmentId: string;
    name: string;
    userId: string;
    displayName: string;
    role: Role;
    version: number;
    subjectIds: string[];
    studentIds?: string[];
};
export type WorkspaceResponse = {
    state: Workspace;
    revision: number;
    owner: string;
    access: WorkspaceAccess;
    staff: StaffMember[];
    workspaces: { id: string; name: string; role: Role }[];
    localAccounts?: { userId: string; displayName: string }[];
};
export type ActorScope = { userId?: string; displayName?: string; subjectIds?: string[]; studentIds?: string[] };
