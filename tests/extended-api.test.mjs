import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDatabase, sqliteDatabase } from '../scripts/sqlite-database.mjs';
import { bootstrapWorkspace, executeCommand, readSnapshot, publicResponse } from '../lib/server/repository.ts';
import { handleWorkspace } from '../lib/server/service.ts';
import { handleDocuments } from '../lib/server/documents.ts';
import { handleReports } from '../lib/server/reports.ts';
import { runDailyJobs, handleJobs } from '../lib/server/jobs.ts';
import { handleRisk, riskFeatures, validateDecisions } from '../lib/server/risk.ts';
const identity={userId:'admin_one',displayName:'Admin One'},workspace='engineering-cse';
const op=(type,payload={})=>({id:crypto.randomUUID(),type,payload});
const headers={'x-expected-user':identity.userId,'x-workspace-id':workspace};
async function setup(t) {
    const sqlite=openDatabase(':memory:');t.after(()=>sqlite.close());const db=sqliteDatabase(sqlite);await bootstrapWorkspace(db,identity);
    return {sqlite,db,run:command=>executeCommand(db,identity.userId,workspace,command)};
}
test('portal membership is persisted, cannot be forged and cannot read other students or documents',async t=>{
    const {db,run}=await setup(t),snapshot=await readSnapshot(db,identity.userId),linked=snapshot.state.students[1];
    await run(op('staff.save',{userId:'parent_one',displayName:'Parent One',role:'parent',active:true,baseVersion:0,subjectIds:[],studentIds:[linked.id]}));
    const portal=publicResponse(await readSnapshot(db,'parent_one'));assert.equal(portal.access.role,'parent');assert.deepEqual(portal.state.students.map(s=>s.id),[linked.id]);
    const req=new Request('https://campus.test/api/workspace',{method:'POST',headers:{'x-expected-user':'parent_one','x-workspace-id':workspace,'x-demo-role':'admin'},body:JSON.stringify(op('fee.adjust',{studentId:linked.id,amount:-1,category:'Concession',reason:'Forged permission'}))});
    assert.equal((await handleWorkspace(db,{userId:'parent_one',displayName:'Parent One'},req)).status,403);
    assert.equal((await handleDocuments(db,null,{userId:'parent_one',displayName:'Parent One'},new Request('https://campus.test/api/documents',{headers:{'x-workspace-id':workspace}}))).status,403);
    assert.equal((await handleReports(db,{userId:'parent_one',displayName:'Parent One'})).status,403);
});
test('document upload/download is protected and arbitrary object references cannot enter through commands',async t=>{
    const {db,run}=await setup(t);const admission=op('admission.create',{reference:'APP-TEST',name:'Synthetic Student',roll:'ENG-24-CSE-0888',email:'demo@example.test',programme:'B.Tech CSE'});await run(admission);
    const objects=new Map(),store={async put(key,bytes,type){objects.set(key,{bytes,type});},async get(key){return objects.get(key)??null;},async delete(key){objects.delete(key);}};
    const form=new FormData();form.set('admissionId',admission.id);form.set('file',new Blob(['%PDF-1.4\nSynthetic test document'],{type:'application/pdf'}),'synthetic.pdf');
    const response=await handleDocuments(db,store,identity,new Request('https://campus.test/api/documents',{method:'POST',headers,body:form}));assert.equal(response.status,200);
    const saved=await response.json(),document=saved.state.erp.records.find(r=>r.kind==='document');assert.equal(objects.size,1);
    const downloaded=await handleDocuments(db,store,identity,new Request(`https://campus.test/api/documents?workspace=${workspace}&id=${document.id}`));assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');assert.match(await downloaded.text(),/^%PDF/);
    const forged=await handleWorkspace(db,identity,new Request('https://campus.test/api/workspace',{method:'POST',headers,body:JSON.stringify(op('document.add',{admissionId:admission.id,objectKey:'documents/another-campus/known-key',size:10,name:'fake.pdf'}))}));assert.equal(forged.status,403);
    const invalid=new FormData();invalid.set('admissionId',admission.id);invalid.set('file',new Blob(['<script>alert(1)</script>'],{type:'application/pdf'}),'forged.pdf');
    assert.equal((await handleDocuments(db,store,identity,new Request('https://campus.test/api/documents',{method:'POST',headers,body:invalid}))).status,400);
});
test('gateway retries and fee adjustments persist with one payment and survive fresh snapshots',async t=>{
    const {db,run}=await setup(t),s=(await readSnapshot(db,identity.userId)).state,st=s.students.find(st=>st.openingDue>0);
    await run(op('fee.adjust',{studentId:st.id,amount:-100,category:'Concession',reason:'Approved test concession'}));
    const order=op('payment.order',{studentId:st.id,amount:20000});await run(order);
    await Promise.all([run(op('payment.completeTest',{orderId:order.id,outcome:'Success'})),run(op('payment.completeTest',{orderId:order.id,outcome:'Success'}))]);
    const after=await readSnapshot(db,identity.userId);assert.equal(after.state.payments.length,1);assert.equal(after.state.payments[0].amount,20000);assert.equal(after.state.erp.records.find(r=>r.id===order.id).data.status,'Success');
});
test('daily job operation IDs are stable and scheduler endpoint rejects missing or incorrect credentials',async t=>{
    const {db}=await setup(t);await runDailyJobs(db,identity.userId);const first=await readSnapshot(db,identity.userId);await runDailyJobs(db,identity.userId);const next=await readSnapshot(db,identity.userId);assert.equal(next.revision,first.revision);
    const request=token=>new Request('https://campus.test/api/jobs',{method:'POST',headers:{Authorization:`Bearer ${token}`}});
    assert.equal((await handleJobs(db,request('incorrect'),{token:'test-job-token',actorId:identity.userId})).status,401);
    assert.equal((await handleJobs(db,request('test-job-token'),{token:'test-job-token',actorId:identity.userId})).status,200);
    assert.equal((await handleJobs(db,request('test-job-token'),{})).status,503);
});
test('risk features omit identity/contact/financial data and reject invented evidence',async t=>{
    const {db}=await setup(t),snapshot=await readSnapshot(db,identity.userId);const {features}=await riskFeatures(snapshot.state,workspace);
    const encoded=JSON.stringify(features);assert.ok(!encoded.includes('Subhashree'));assert.ok(!encoded.includes('openingDue'));assert.ok(!encoded.includes('s-0412'));
    assert.ok(features.every(f=>!f.sufficientHistory));
    assert.throws(()=>validateDecisions([{subject:features[0].subject,needsReview:true,explanation:'Review required',evidenceIds:['invented']}],[features[0]]),/unsupported evidence/);
    const response=await handleRisk(db,identity,new Request('https://campus.test/api/risk',{method:'POST',headers}),{});assert.equal(response.status,503);
});
test('configured AI adapter accepts evidence-backed decisions and only creates mentor tasks',async t=>{
    const {db,run}=await setup(t);const before=(await readSnapshot(db,identity.userId)).state;
    for(const ago of [3,4,5,6,32,33,34,35]) {
        const date=new Date(Date.now()-ago*86400000).toISOString().slice(0,10);
        await run(op('attendance.save',{subjectId:'cs201',date,period:1,baseVersion:0,entries:Object.fromEntries(before.students.map(st=>[st.id,ago>28]))}));
    }
    const snapshot=await readSnapshot(db,identity.userId);
    const fake=async(url,init)=>{const body=JSON.parse(init.body);assert.equal(url,'https://ai.example.test/review');assert.ok(!JSON.stringify(body).includes('Subhashree'));return Response.json({decisions:body.features.map(feature=>({subject:feature.subject,needsReview:true,explanation:'Recent attendance is below the previous window.',evidenceIds:feature.evidenceIds}))});};
    const response=await handleRisk(db,identity,new Request('https://campus.test/api/risk',{method:'POST',headers}),{endpoint:'https://ai.example.test/review',token:'test-token',model:'synthetic-test-provider'},fake);
    assert.equal(response.status,200);const after=await readSnapshot(db,identity.userId);assert.equal(after.state.tasks.length,24);assert.deepEqual(after.state.payments,snapshot.state.payments);assert.deepEqual(after.state.marks,snapshot.state.marks);assert.deepEqual(after.state.attendance,snapshot.state.attendance);
});
test('new campus creation starts empty with scoped membership and configurable cohort imports',async t=>{
    const {db}=await setup(t);const command=op('workspace.create',{name:'Management campus / MBA',campusId:'management',departmentId:'mba',programme:'MBA',batch:'2026-2028',year:1,section:'B'});
    const response=await handleWorkspace(db,identity,new Request('https://campus.test/api/workspace',{method:'POST',headers,body:JSON.stringify(command)}));assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.state.students.length,0);assert.equal(body.state.subjects.length,0);assert.equal(body.state.settings.programme,'MBA');
    const imported=await executeCommand(db,identity.userId,body.access.workspaceId,op('students.import',{students:[{roll:'MBA-26-001',name:'Synthetic MBA Student',programme:'MBA',year:1,due:0}]}));assert.equal(imported.state.students[0].section,'B');
    const repeat=await handleWorkspace(db,identity,new Request('https://campus.test/api/workspace',{method:'POST',headers,body:JSON.stringify(command)}));assert.equal((await repeat.json()).state.students.length,1);
    const report=await handleReports(db,identity);assert.equal((await report.json()).campuses.length,2);
});
test('SQLite backup and restoration preserve relational data and refuse to overwrite an existing file',async t=>{
    const dir=mkdtempSync(join(tmpdir(),'campus-backup-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
    const source=join(dir,'source.sqlite'),backup=join(dir,'backup.sqlite'),restored=join(dir,'restored.sqlite');
    const sqlite=openDatabase(source),db=sqliteDatabase(sqlite);await bootstrapWorkspace(db,identity);sqlite.close();
    const script=resolve('scripts/backup.mjs');
    execFileSync(process.execPath,[script,'create',source,backup]);execFileSync(process.execPath,[script,'restore',backup,restored]);
    const checked=JSON.parse(execFileSync(process.execPath,[script,'verify',restored],{encoding:'utf8'}));assert.equal(checked.counts.students,24);
    assert.throws(()=>execFileSync(process.execPath,[script,'restore',backup,restored],{stdio:'pipe'}));
});
