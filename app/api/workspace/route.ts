import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { d1Database } from '../../../lib/server/d1';
import { handleWorkspace, json } from '../../../lib/server/service';
import { initializeLocalAccess } from '../../../lib/server/local-access';
import { frameworkAccounts } from '../../../lib/local-accounts';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  if (!env.DB) return json({error:'Database binding is unavailable.'},503);
  const user = await getChatGPTUser();
  if (import.meta.env.DEV && user && frameworkAccounts.some(account => account.userId === user.userId)
      && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)) {
    await initializeLocalAccess(d1Database(env.DB));
  }
  return handleWorkspace(d1Database(env.DB),user ? {userId:user.userId,displayName:user.displayName} : null,request,{bootstrapOwnerId:env.CAMPUS_BOOTSTRAP_OWNER_ID});
}
export const GET = handle;
export const POST = handle;
