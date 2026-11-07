import type { Database } from './database.ts';
import type { Identity } from './service.ts';
import type { Workspace } from '../types.ts';
import { json } from './service.ts';
import { readSnapshot, executeCommand } from './repository.ts';
import { scopeState, markTotal } from '../domain.ts';
import { cancelledPeriod } from '../erp.ts';
export type RiskFeature = {subject:string;recent:{held:number;present:number};previous:{held:number;present:number};lockedMean:number|null;evidenceIds:string[];sufficientHistory:boolean};
export async function riskFeatures(state: Workspace, workspaceId:string, now=Date.now()) {
    const mapping = new Map<string,string>(), features:RiskFeature[]=[];
    for (const student of state.students) {
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${workspaceId}:${student.id}`));
        const subject=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');mapping.set(subject,student.id);
        const windows=[{held:0,present:0},{held:0,present:0}];const evidenceIds:string[]=[];
        for(const session of Object.values(state.attendance)) {
            const age=now-Date.parse(`${session.date}T00:00:00+05:30`);
            if(age<0||age>=56*86400000||session.entries[student.id]===undefined||cancelledPeriod(state,session.id))continue;
            const bucket=age<28*86400000?0:1;windows[bucket].held++;if(session.entries[student.id])windows[bucket].present++;
            evidenceIds.push(`attendance:${session.id}:v${session.version}`);
        }
        const totals=Object.entries(state.marks).filter(([,b])=>b.status==='Locked').flatMap(([id,b])=>{
            const total=markTotal(b.rows[student.id]);if(total===null)return[];evidenceIds.push(`marks:${id}:v${b.version}`);return[total];
        });
        features.push({subject,recent:windows[0],previous:windows[1],lockedMean:totals.length?totals.reduce((a,b)=>a+b,0)/totals.length:null,evidenceIds,sufficientHistory:windows.every(w=>w.held>=4)});
    }
    return {features,mapping};
}
export type RiskDecision={subject:string;needsReview:boolean;explanation:string;evidenceIds:string[]};
export function validateDecisions(value:unknown,features:RiskFeature[]):RiskDecision[] {
    if(!Array.isArray(value)||value.length!==features.length)throw new Error('Provider returned the wrong number of decisions.');
    const seen=new Set<string>();
    return value.map(row=>{
        const feature=features.find(f=>f.subject===row?.subject);
        if(!feature||seen.has(row.subject)||typeof row.needsReview!=='boolean'||typeof row.explanation!=='string'||row.explanation.length<2||row.explanation.length>500||!Array.isArray(row.evidenceIds)||!row.evidenceIds.length||row.evidenceIds.some((id:unknown)=>typeof id!=='string'||!feature.evidenceIds.includes(id)))throw new Error('Provider returned invalid or unsupported evidence.');
        seen.add(row.subject);return{subject:row.subject,needsReview:row.needsReview,explanation:row.explanation,evidenceIds:row.evidenceIds};
    });
}
export async function handleRisk(db:Database,identity:Identity|null,request:Request,config:{endpoint?:string;token?:string;model?:string},fetcher:typeof fetch=fetch) {
    try {
        if(!identity)return json({error:'Sign in first.'},401);
        if(request.method!=='POST')return json({error:'Method not allowed.'},405);
        if(request.headers.get('x-expected-user')!==identity.userId)return json({error:'The signed-in account changed.'},401);
        if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return json({error:'Cross-origin requests are not allowed.'},403);
        const snapshot=await readSnapshot(db,identity.userId,request.headers.get('x-workspace-id')||undefined);
        if(!['admin','faculty'].includes(snapshot.access.role))return json({error:'Staff permission required.'},403);
        const {features,mapping}=await riskFeatures(scopeState(snapshot.state,snapshot.access.role,snapshot.access),snapshot.access.workspaceId);
        const eligible=features.filter(f=>f.sufficientHistory);
        if(!config.endpoint||!config.token||!config.model)return json({error:'AI provider is not configured. Fixed-rule support signals remain available.',insufficientHistory:features.filter(f=>!f.sufficientHistory).length},503);
        if(!config.endpoint.startsWith('https://'))return json({error:'AI endpoint must use HTTPS.'},503);
        if(!eligible.length)return json({decisions:[],insufficientHistory:features.length});
        const response=await fetcher(config.endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.token}`},body:JSON.stringify({model:config.model,promptVersion:'campus-risk-v1',instructions:'Return a decisions array. Flag for mentor review only. Use only supplied evidence IDs. Do not infer dropout probabilities or marks trends from a single snapshot.',features:eligible}),signal:AbortSignal.timeout(20000)});
        if(!response.ok)throw new Error('Provider unavailable');
        const body=await response.text();if(body.length>300000)throw new Error('Provider response too large');
        const decisions=validateDecisions(JSON.parse(body).decisions,eligible);
        const current=await readSnapshot(db,identity.userId,snapshot.access.workspaceId);
        if(current.revision!==snapshot.revision)return json({error:'Campus data changed during analysis. Run the analysis again.'},409);
        const payload={sourceRevision:snapshot.revision,model:config.model,promptVersion:'campus-risk-v1',decisions:decisions.map(d=>({...d,studentId:mapping.get(d.subject)}))};
        await executeCommand(db,identity.userId,snapshot.access.workspaceId,{id:crypto.randomUUID(),type:'risk.record',payload});
        return json({decisions,insufficientHistory:features.filter(f=>!f.sufficientHistory).length});
    } catch {return json({error:'AI analysis is unavailable or its evidence could not be validated. Fixed-rule signals are unchanged.'},503);}
}
