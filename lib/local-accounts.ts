// Development identities only. Hosted authentication is owned by Sites.
export const frameworkAccounts = [
    { userId: 'local_seedy', displayName: 'Office admin', email: 'office@campus.test', role: 'admin' },
    { userId: 'local_faculty', displayName: 'Dr. Priyanka Das', email: 'teacher@campus.test', role: 'faculty' },
    { userId: 'local_student', displayName: 'Student account', email: 'student@campus.test', role: 'student' },
    { userId: 'local_parent', displayName: 'Parent account', email: 'parent@campus.test', role: 'parent' },
] as const;

export function localAccount(cookie: string | undefined) {
    // Retain the starter's existing admin cookie while adding individual accounts.
    return frameworkAccounts.find(account => account.userId === (cookie === '1' ? 'local_seedy' : cookie));
}
