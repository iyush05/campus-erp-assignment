import type { Workspace, Student } from './types.ts';
export const sampleRecords = [
    { roll: 'ENG-24-CSE-0412', name: 'Subhashree Mohanty', programme: 'B.Tech CSE', year: 2, attendance: 81.5, marks: 33, due: 0 },
    { roll: 'ENG-24-ME-0177', name: 'Ankit Panda', programme: 'B.Tech Mechanical', year: 2, attendance: 68.2, marks: 21, due: 45000 },
    { roll: 'MBA-25-0093', name: 'Farheen Ali', programme: 'MBA', year: 1, attendance: 92, marks: 36, due: 0 },
];
export function createSeed(): Workspace {
    const names = ['Aarav Das', 'Aditi Mishra', 'Ananya Sahoo', 'Arjun Nayak', 'Debasish Rout', 'Diya Patnaik', 'Ishaan Behera', 'Kavya Dash', 'Manas Pradhan', 'Meera Sethi', 'Nikhil Jena', 'Pallavi Sahu', 'Pranav Biswal', 'Priya Mohapatra', 'Rishabh Swain', 'Ritika Das', 'Rohan Tripathy', 'Saanvi Panda', 'Sambit Pati', 'Shreya Rout', 'Siddharth Sahoo', 'Sneha Nayak', 'Tanmay Mishra'];
    const students: Student[] = [{ id: 's-0412', name: 'Subhashree Mohanty', roll: 'ENG-24-CSE-0412', year: 2, section: 'A', category: 'General', baseline: null, legacyAttendance: 81.5, openingDue: 0, synthetic: false }, ...names.map((name, i) => ({ id: `s-${i + 1}`, name, roll: `ENG-24-CSE-${i === 11 ? '0430' : String(401 + i).padStart(4, '0')}`, year: 2, section: 'A', category: i % 5 === 0 ? 'Scholarship' : 'General', baseline: { held: 40, present: [38, 35, 28, 37, 26, 36, 34, 39, 29, 35, 32, 38, 27, 36, 34, 38, 35, 37, 33, 36, 39, 34, 37][i] }, openingDue: i % 4 === 0 ? 4500000 : i % 7 === 0 ? 2250000 : 0, synthetic: true }))];
    const subjects = [
        { id: 'cs201', code: 'CS 201', name: 'Data Structures', faculty: 'Dr. Priyanka Das', room: 'Room 204', time: '09:00 – 10:00', period: 1 },
        { id: 'cs202', code: 'CS 202', name: 'Database Management', faculty: 'Dr. Amit Mishra', room: 'Room 206', time: '10:00 – 11:00', period: 2 },
        { id: 'cs203', code: 'CS 203', name: 'Computer Networks', faculty: 'Dr. Priyanka Das', room: 'Lab 02', time: '11:15 – 12:15', period: 3 },
        { id: 'cs204', code: 'CS 204', name: 'Discrete Mathematics', faculty: 'Dr. S. Patnaik', room: 'Room 204', time: '14:00 – 15:00', period: 4 },
    ];
    const marks = Object.fromEntries(subjects.map(s => [s.id, { status: 'Draft' as const, version: 0, rows: Object.fromEntries(students.map((s, i) => [s.id, s.synthetic ? { test: i % 6 === 0 ? 9 : 14 + i % 6, assignment: 6 + i % 5, practical: 6 + i % 5 } : { test: null, assignment: null, practical: null }])) }]));
    return { students, subjects, marks, attendance: {}, payments: [], tasks: [], audit: [], operations: [], settings: { programme: 'B.Tech CSE', batch: '2024–2028', semester: 'Semester 3', academicYear: '2026–27', attendanceThreshold: 75 } };
}
