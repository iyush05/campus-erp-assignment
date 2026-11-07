import type { Database } from './database.ts';
import type { Identity } from './service.ts';
import { json } from './service.ts';
import { listWorkspaces, readSnapshot } from './repository.ts';
import { dueFor } from '../domain.ts';
import { missingPeriods } from '../erp.ts';
export async function handleReports(db: Database, identity: Identity | null) {
    if (!identity) return json({error:'Sign in first.'},401);
    const available = (await listWorkspaces(db,identity.userId)).filter(w => w.role === 'admin');
    if (!available.length) return json({error:'Office admin permission is required.'},403);
    const campuses = [];
    for (const w of available) {
        const snapshot = await readSnapshot(db,identity.userId,w.id);
        if (snapshot.access.role !== 'admin') continue;
        campuses.push({id:w.id,name:w.name,students:snapshot.state.students.length,dues:snapshot.state.students.reduce((sum,st)=>sum+dueFor(snapshot.state,st),0),missingPeriods:missingPeriods(snapshot.state).length});
    }
    return json({campuses});
}
