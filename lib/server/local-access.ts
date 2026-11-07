import type { Database } from './database.ts';
import { query } from './database.ts';
import { bootstrapWorkspace, executeCommand, readSnapshot } from './repository.ts';
import { frameworkAccounts } from '../local-accounts.ts';

/** Called only by the loopback development route, never by a hosted build. */
export async function initializeLocalAccess(db: Database) {
    const admin = frameworkAccounts[0], workspace = 'engineering-cse';
    await bootstrapWorkspace(db, admin);
    // Do not assume ownership of a database bootstrapped by a different account.
    const owner = await query(db, 'SELECT role,active FROM staff_members WHERE workspace_id=? AND user_id=?', workspace, admin.userId);
    if (owner[0]?.role !== 'admin' || owner[0]?.active !== 1) return;
    const snapshot = await readSnapshot(db, admin.userId, workspace);
    for (const account of frameworkAccounts.slice(1)) {
        // Existing assignments and revocations must survive reloads and restarts.
        if (snapshot.staff.some(member => member.userId === account.userId)) continue;
        const studentId = snapshot.state.students.find(student => student.id === 's-0412')?.id;
        if (account.role !== 'faculty' && !studentId) continue;
        try {
            await executeCommand(db, admin.userId, workspace, {
                id: `local-account-v1-${account.userId}`, type: 'staff.save',
                payload: { ...account, active: true, baseVersion: 0,
                    subjectIds: account.role === 'faculty' ? snapshot.state.subjects.filter(subject => ['cs201', 'cs203'].includes(subject.id)).map(subject => subject.id) : [],
                    studentIds: account.role === 'faculty' ? [] : [studentId] },
            });
        } catch (error) {
            // A concurrent first request can initialize the same identity.
            const current = await readSnapshot(db, admin.userId, workspace);
            if (!current.staff.some(member => member.userId === account.userId)) throw error;
        }
    }
}
