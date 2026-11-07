import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { d1Database } from '../../../lib/server/d1';
import { handleReports } from '../../../lib/server/reports';
import { json } from '../../../lib/server/service';
export const dynamic = 'force-dynamic';
export async function GET() {
    if (!env.DB) return json({error:'Database is unavailable.'},503);
    const user=await getChatGPTUser();
    return handleReports(d1Database(env.DB),user ? {userId:user.userId,displayName:user.displayName} : null);
}
