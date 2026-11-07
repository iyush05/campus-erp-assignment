import type { Database } from './database.ts';
import type { Identity } from './service.ts';
import { json } from './service.ts';
import { readSnapshot, executeCommand } from './repository.ts';
import { DomainError } from '../errors.ts';
export interface DocumentStore {
    put(key: string, bytes: Uint8Array, type: string): Promise<void>;
    get(key: string): Promise<{bytes: Uint8Array; type: string} | null>;
    delete(key: string): Promise<void>;
}
export async function handleDocuments(db: Database, store: DocumentStore | null, identity: Identity | null, request: Request) {
    try {
        if (!identity) return json({error:'Sign in first.'},401);
        const workspaceId = request.headers.get('x-workspace-id') || new URL(request.url).searchParams.get('workspace') || undefined;
        const snapshot = await readSnapshot(db,identity.userId,workspaceId);
        if (snapshot.access.role !== 'admin') return json({error:'Admission documents are restricted to office admins.'},403);
        if (!store) return json({error:'Document storage is not configured.'},503);
        if (request.method === 'GET') {
            const record = snapshot.state.erp?.records.find(r => r.kind === 'document' && r.id === new URL(request.url).searchParams.get('id'));
            if (!record) return json({error:'Document not found.'},404);
            const saved = await store.get(record.data.objectKey);
            if (!saved) return json({error:'Document content is unavailable.'},404);
            return new Response(saved.bytes as BodyInit,{headers:{'Content-Type':saved.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="${record.data.name.replace(/[^A-Za-z0-9._-]/g,'_')}"`}});
        }
        if (request.method !== 'POST') return json({error:'Method not allowed.'},405);
        if (request.headers.get('x-expected-user') !== identity.userId) return json({error:'The signed-in account changed.'},401);
        if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return json({error:'Cross-origin uploads are not allowed.'},403);
        if (Number(request.headers.get('content-length')) > 2100000) return json({error:'Document limit is 2 MB.'},413);
        const form = await request.formData(), file = form.get('file'), admissionId = form.get('admissionId');
        if (!file || typeof file === 'string' || file.size > 2000000 || file.size === 0) return json({error:'Choose a PDF, PNG or JPEG under 2 MB.'},400);
        if (!snapshot.state.erp?.records.some(r => r.kind === 'admission' && r.id === admissionId)) return json({error:'Application not found.'},404);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const type = bytes.slice(0,5).every((v,i)=>v === [37,80,68,70,45][i]) ? 'application/pdf' : bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71 ? 'image/png' : bytes[0]===255 && bytes[1]===216 && bytes[2]===255 ? 'image/jpeg' : null;
        if (!type) return json({error:'Only PDF, PNG and JPEG content is accepted.'},400);
        const id = crypto.randomUUID(), key = `documents/${encodeURIComponent(snapshot.access.workspaceId)}/${id}`;
        await store.put(key,bytes,type);
        try {
            return json(await executeCommand(db,identity.userId,snapshot.access.workspaceId,{id,type:'document.add',payload:{admissionId,name:file.name,objectKey:key,contentType:type,size:file.size}}));
        } catch (error) {
            // A transport failure after commit is ambiguous: retain the object if metadata exists.
            const current = await readSnapshot(db,identity.userId,snapshot.access.workspaceId).catch(() => null);
            if (current && !current.state.erp?.records.some(r => r.id === id)) await store.delete(key);
            throw error;
        }
    } catch (error) { return json({error:error instanceof DomainError ? error.message : 'Document request failed.'},error instanceof DomainError ? error.status : 500); }
}
