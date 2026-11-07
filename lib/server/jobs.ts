import type { Database } from './database.ts';
import { listWorkspaces, executeCommand } from './repository.ts';
import { todayIST } from '../domain.ts';
import { json } from './service.ts';
export async function runDailyJobs(db: Database, actorId: string) {
    const workspaces = (await listWorkspaces(db,actorId)).filter(w=>w.role==='admin');
    const results = [];
    for (const workspace of workspaces) {
        const command = {id:`daily-reminders:${todayIST()}:${workspace.id}`,type:'jobs.run',payload:{}};
        await executeCommand(db,actorId,workspace.id,command);
        results.push({workspaceId:workspace.id,status:'Completed (test)'});
    }
    return results;
}
export async function handleJobs(db: Database, request: Request, config:{token?:string;actorId?:string}) {
    if (!config.token || !config.actorId) return json({error:'Scheduled job credentials are not configured.'},503);
    if (request.method !== 'POST') return json({error:'Method not allowed.'},405);
    const header = request.headers.get('authorization') ?? '';
    if (!header.startsWith('Bearer ') || header.length > 500) return json({error:'Unauthorized.'},401);
    const hash = async (text:string) => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
    const [actual,expected] = await Promise.all([hash(header.slice(7)),hash(config.token)]);
    let difference=0;for(let i=0;i<actual.length;i++)difference|=actual[i]^expected[i];
    if (difference) return json({error:'Unauthorized.'},401);
    try { return json({runs:await runDailyJobs(db,config.actorId)}); }
    catch { return json({error:'Job run failed; retry uses the same daily operation IDs.'},500); }
}
