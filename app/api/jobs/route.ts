import { env } from 'cloudflare:workers';
import { d1Database } from '../../../lib/server/d1';
import { handleJobs } from '../../../lib/server/jobs';
import { json } from '../../../lib/server/service';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
    if (!env.DB) return json({error:'Database is unavailable.'},503);
    return handleJobs(d1Database(env.DB),request,{token:env.CAMPUS_JOB_TOKEN,actorId:env.CAMPUS_JOB_ACTOR_ID});
}
