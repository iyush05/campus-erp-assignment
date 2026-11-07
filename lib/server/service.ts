import { DomainError } from '../domain.ts';
import { bootstrapWorkspace, executeCommand, publicResponse, readSnapshot } from './repository.ts';
import type { Database } from './database.ts';
export type Identity = { userId: string; displayName: string };
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function handleWorkspace(db: Database, identity: Identity | null, request: Request, options: { bootstrapOwnerId?: string } = {}) {
  try {
    if (!identity) return json({error:'Sign in to access campus records.'},401);
    if (options.bootstrapOwnerId && identity.userId === options.bootstrapOwnerId) await bootstrapWorkspace(db,identity);
    const workspace = request.headers.get('x-workspace-id') || undefined;
    if (request.method === 'GET') return json(publicResponse(await readSnapshot(db,identity.userId,workspace)));
    if (request.method !== 'POST') return json({error:'Method not allowed.'},405);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return json({error:'Cross-origin changes are not allowed.'},403);
    if (request.headers.get('x-expected-user') !== identity.userId) return json({error:'The signed-in account changed. Refresh before sending records saved by another account.'},401);
    const text = await request.text();
    if (text.length > 300000) return json({error:'Request is too large.'},413);
    let command; try { command = JSON.parse(text); } catch { return json({error:'Invalid JSON.'},400); }
    if (command?.type === 'workspace.create') {
      const current = await readSnapshot(db,identity.userId,workspace);
      if (current.access.role !== 'admin') throw new DomainError('Office admin permission required.',403);
      const p = command.payload;
      if (!p || !['name','campusId','departmentId','programme','section','batch'].every(k=>typeof p[k]==='string' && p[k].trim().length>0 && p[k].length<=100) || !Number.isInteger(p.year) || p.year<1 || p.year>6 || typeof command.id!=='string' || !/^[a-zA-Z0-9-]{8,100}$/.test(command.id)) throw new DomainError('Provide campus, department, programme, batch, year and section.');
      const id = `campus-${command.id}`;
      await bootstrapWorkspace(db,identity,id,{name:p.name,campusId:p.campusId,departmentId:p.departmentId,programme:p.programme,year:p.year,section:p.section,batch:p.batch});
      return json(publicResponse(await readSnapshot(db,identity.userId,id)));
    }
    if (['document.add','risk.record'].includes(command?.type)) return json({error:'Use the dedicated server endpoint.'},403);
    return json(await executeCommand(db,identity.userId,workspace,command));
  } catch (error) {
    return json({error:error instanceof DomainError ? error.message : 'The change could not be completed. No partial transaction was committed.',...(error instanceof DomainError && error.status === 403 ? {accountId:identity?.userId} : {})},error instanceof DomainError ? error.status : 500);
  }
}
