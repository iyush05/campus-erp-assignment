import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { d1Database } from '../../../lib/server/d1';
import { handleRisk } from '../../../lib/server/risk';
import { json } from '../../../lib/server/service';
export const dynamic = 'force-dynamic';
export async function POST(request:Request) {
    if(!env.DB)return json({error:'Database unavailable.'},503);
    const user=await getChatGPTUser();
    return handleRisk(d1Database(env.DB),user?{userId:user.userId,displayName:user.displayName}:null,request,{endpoint:env.CAMPUS_AI_ENDPOINT,token:env.CAMPUS_AI_TOKEN,model:env.CAMPUS_AI_MODEL});
}
