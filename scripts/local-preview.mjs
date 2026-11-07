// This identity switch exists only in the loopback preview, never in the Worker.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase, sqliteDatabase } from './sqlite-database.mjs';
import { bootstrapWorkspace, executeCommand } from '../lib/server/repository.ts';
import { handleRisk } from '../lib/server/risk.ts';
import { handleJobs } from '../lib/server/jobs.ts';
import { handleReports } from '../lib/server/reports.ts';
import { handleDocuments } from '../lib/server/documents.ts';
import { handleWorkspace } from '../lib/server/service.ts';
export const localAccounts = [
  {userId:'local_demo',displayName:'Office admin'},
  {userId:'local_faculty',displayName:'Dr. Priyanka Das'},
  {userId:'local_faculty_amit',displayName:'Dr. Amit Mishra'},
  {userId:'local_student',displayName:'Demo student'},
  {userId:'local_parent',displayName:'Demo parent'},
];
export function openPreviewDatabase(path) { return openDatabase(path); }
export async function initializePreview(sqlite) {
  const existing = sqlite.prepare('SELECT id FROM campus_workspaces WHERE id=?').get('engineering-cse');
  const db = sqliteDatabase(sqlite);
  await bootstrapWorkspace(db,localAccounts[0]);
  if (!existing) for (const [i,person] of localAccounts.slice(1,3).entries()) {
    await executeCommand(db,'local_demo','engineering-cse',{id:crypto.randomUUID(),type:'staff.save',payload:{...person,role:'faculty',active:true,baseVersion:0,subjectIds:i === 0 ? ['cs201','cs203'] : ['cs202']}});
  }
  for (const [i,person] of localAccounts.slice(3).entries()) if (!sqlite.prepare('SELECT user_id FROM portal_members WHERE workspace_id=? AND user_id=?').get('engineering-cse',person.userId) && !sqlite.prepare('SELECT user_id FROM staff_members WHERE workspace_id=? AND user_id=?').get('engineering-cse',person.userId)) {
    await executeCommand(db,'local_demo','engineering-cse',{id:crypto.randomUUID(),type:'staff.save',payload:{...person,role:i===0?'student':'parent',active:true,baseVersion:0,subjectIds:[],studentIds:['s-0412']}});
  }
}
export function createPreviewHandler(sqlite, { root, port = 4173 }) {
  const ready = initializePreview(sqlite), db = sqliteDatabase(sqlite);
  return async (req,res) => {
    const send = (status,body,extra={}) => { res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...extra}); res.end(JSON.stringify(body)); };
    try {
      if (![ `127.0.0.1:${port}`,`localhost:${port}` ].includes(req.headers.host)) return send(403,{error:'Loopback development only.'});
      const origin = `http://${req.headers.host}`, url = new URL(req.url,origin);
      if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== origin) return send(403,{error:'Cross-origin changes are not allowed.'});
      await ready;
      const cookie = (req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith('campus_demo_account='))?.split('=')[1];
      const identity = cookie ? localAccounts.find(a => a.userId === cookie) ?? null : localAccounts[0];
      if (url.pathname === '/api/demo/account') {
        if (req.method === 'GET') return send(identity ? 200 : 401, { owner: identity?.userId ?? null });
        if (req.method !== 'POST') return send(405,{error:'Method not allowed.'});
        let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 1024) return send(413,{error:'Request too large.'}); }
        let body; try { body = JSON.parse(text); } catch { return send(400,{error:'Invalid JSON.'}); }
        if (body.signOut === true) return send(200,{ok:true},{'Set-Cookie':'campus_demo_account=signed_out; HttpOnly; SameSite=Strict; Path=/'});
        if (!localAccounts.some(a => a.userId === body.userId)) return send(403,{error:'Unknown local preview account.'});
        return send(200,{ok:true},{'Set-Cookie':`campus_demo_account=${body.userId}; HttpOnly; SameSite=Strict; Path=/`});
      }
      if (url.pathname === '/api/risk' || url.pathname === '/api/jobs') {
        const request = new Request(url,{method:req.method,headers:req.headers});
        const response = url.pathname === '/api/risk' ? await handleRisk(db,identity,request,{endpoint:process.env.CAMPUS_AI_ENDPOINT,token:process.env.CAMPUS_AI_TOKEN,model:process.env.CAMPUS_AI_MODEL}) : await handleJobs(db,request,{token:process.env.CAMPUS_JOB_TOKEN,actorId:process.env.CAMPUS_JOB_ACTOR_ID});
        return send(response.status,await response.json());
      }
      if (url.pathname === '/api/reports') {
        if (req.method !== 'GET') return send(405,{error:'Method not allowed.'});
        const response = await handleReports(db,identity); return send(response.status,await response.json());
      }
      if (url.pathname === '/api/documents') {
        const chunks = []; let size = 0;
        if (req.method !== 'GET') for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 2100000) return send(413,{error:'Document limit is 2 MB.'}); chunks.push(bytes); }
        const store = {
          async put(key,bytes,type) { sqlite.prepare('INSERT INTO local_documents VALUES (?,?,?)').run(key,type,Buffer.from(bytes).toString('base64')); },
          async get(key) { const row = sqlite.prepare('SELECT * FROM local_documents WHERE object_key=?').get(key); return row ? {bytes:Buffer.from(row.content_base64,'base64'),type:row.content_type} : null; },
          async delete(key) { sqlite.prepare('DELETE FROM local_documents WHERE object_key=?').run(key); },
        };
        const response = await handleDocuments(db,store,identity,new Request(url,{method:req.method,headers:req.headers,...(req.method !== 'GET' ? {body:Buffer.concat(chunks)} : {})}));
        res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (url.pathname === '/api/workspace') {
        let body = ''; if (req.method !== 'GET') for await (const chunk of req) { body += chunk; if (body.length > 300000) return send(413,{error:'Request is too large.'}); }
        const request = new Request(url,{method:req.method,headers:req.headers,...(req.method !== 'GET' ? {body} : {})});
        const response = await handleWorkspace(db,identity,request);
        const data = await response.json(); if (response.ok) data.localAccounts = localAccounts;
        return send(response.status,data);
      }
      if (req.method !== 'GET') return send(405,{error:'Method not allowed.'});
      const path = resolve(root,'.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(root + '/')) return send(403,{error:'Forbidden.'});
      const contents = await readFile(path), types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
      res.writeHead(200,{'Content-Type':types[extname(path)] || 'application/octet-stream','Cache-Control':'no-cache'});res.end(contents);
    } catch (error) { send(error.code === 'ENOENT' ? 404 : 500,{error:'Preview request failed.'}); }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await mkdir('.sites-runtime',{recursive:true});
  const db = openPreviewDatabase('.sites-runtime/preview.sqlite'),port = Number(process.env.PORT || 4173);
  const server = createServer(createPreviewHandler(db,{root:resolve('outputs/local-preview'),port}));
  server.on('error',error => { console.error(`Could not start preview: ${error.message}`);db.close();process.exitCode=1; });
  server.listen(port,'127.0.0.1',() => console.log(`Campus local demo: http://127.0.0.1:${port}`));
  process.on('SIGINT',() => server.close(() => { db.close();process.exit(0); }));
}
