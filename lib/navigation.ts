import type { Role } from './types';
export type WorkspacePage = { id: string; label: string };
export const roleName = (role: Role) => ({ admin: 'Office admin', faculty: 'Teacher', student: 'Student', parent: 'Parent' })[role];
export function navigationFor(role: Role): WorkspacePage[] {
    if (role === 'student' || role === 'parent') return [
        { id: 'overview', label: role === 'student' ? 'My dashboard' : 'Family dashboard' },
        { id: 'profile', label: role === 'student' ? 'My profile' : 'Student profiles' },
        { id: 'register', label: 'Attendance' }, { id: 'marks', label: 'Published results' },
        { id: 'fees', label: 'Fees & receipts' }, { id: 'messages', label: 'Messages' },
        { id: 'requests', label: 'Data requests' },
    ];
    const shared = [
        { id: 'overview', label: role === 'faculty' ? 'Teacher dashboard' : 'Overview' },
        { id: 'students', label: role === 'faculty' ? 'My students' : 'Students' },
        { id: 'attendance', label: 'Take attendance' }, { id: 'register', label: 'Attendance register' },
        { id: 'marks', label: 'Internal marks' },
    ];
    return role === 'faculty' ? [...shared, { id: 'support', label: 'Mentor support' }, { id: 'leave', label: 'My leave' }]
        : [...shared, { id: 'fees', label: 'Fees & dues' }, { id: 'support', label: 'Student support' }, { id: 'setup', label: 'Academic setup' }];
}
export function allowedPage(role: Role, page: string) {
    return navigationFor(role).some(item => item.id === page) ? page : 'overview';
}
