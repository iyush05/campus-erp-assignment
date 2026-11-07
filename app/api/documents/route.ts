import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { d1Database } from '../../../lib/server/d1';
import { handleDocuments, type DocumentStore } from '../../../lib/server/documents';
import { json } from '../../../lib/server/service';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
    if (!env.DB) return json({error:'Database is unavailable.'},503);
    const user = await getChatGPTUser(), bucket = env.BUCKET;
    const store: DocumentStore | null = bucket ? {
        async put(key,bytes,type) { await bucket.put(key,bytes,{httpMetadata:{contentType:type}}); },
        async get(key) { const obj = await bucket.get(key); return obj ? {bytes:new Uint8Array(await obj.arrayBuffer()),type:obj.httpMetadata?.contentType ?? 'application/octet-stream'} : null; },
        async delete(key) { await bucket.delete(key); },
    } : null;
    return handleDocuments(d1Database(env.DB),store,user ? {userId:user.userId,displayName:user.displayName} : null,request);
}
export const GET = handle;
export const POST = handle;
