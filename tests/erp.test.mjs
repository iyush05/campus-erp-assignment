import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../lib/seed.ts';
import { applyCommand, dueFor, scopeState, todayIST, markTotal, attendanceRate } from '../lib/domain.ts';
import { erpRecords, missingPeriods } from '../lib/erp.ts';
const actor={userId:'admin_one',displayName:'Admin One'};
const op=(type,payload={})=>({id:crypto.randomUUID(),type,payload});
const run=(s,type,payload={},role='admin',who=actor)=>applyCommand(s,op(type,payload),role,undefined,who);
const record=(s,kind)=>erpRecords(s,kind).at(-1);
test('fee structures, concessions and reversals preserve derived balances without repeated assessments',()=>{
    let s=createSeed(); const st=s.students.find(st=>st.openingDue>0),initial=dueFor(s,st);
    s=run(s,'feeRule.save',{name:'Semester fee',category:'All',amount:10000,dueDate:todayIST()});const rule=record(s,'feeRule');
    s=run(s,'feeRule.assess',{id:rule.id,baseVersion:1,term:'Term 3'});
    s=run(s,'feeRule.assess',{id:rule.id,baseVersion:1,term:'Term 3'});
    assert.equal(dueFor(s,st),initial+10000);
    s=run(s,'fee.adjust',{studentId:st.id,amount:-5000,category:'Scholarship',reason:'Approved scholarship'});const adjustment=record(s,'fee');
    assert.equal(dueFor(s,st),initial+5000);
    s=run(s,'fee.reverse',{id:adjustment.id,reason:'Approval corrected'});assert.equal(dueFor(s,st),initial+10000);
    assert.throws(()=>run(s,'fee.reverse',{id:adjustment.id,reason:'Duplicate reversal'}),/already reversed/);
    assert.throws(()=>run(s,'fee.adjust',{studentId:st.id,amount:-100000000,category:'Concession',reason:'Exceeds balance'}),/exceeds/);
});
test('mock gateway pending, failure, cancellation, success and duplicate outcomes are safe',()=>{
    let s=createSeed();const st=s.students.find(st=>st.openingDue>0),initial=dueFor(s,st);
    for(const outcome of ['Failed','Cancelled','Success']) {
        s=run(s,'payment.order',{studentId:st.id,amount:12345});const order=record(s,'order');
        assert.equal(order.data.status,'Pending');assert.equal(s.payments.length,0);
        s=run(s,'payment.completeTest',{orderId:order.id,outcome});
        s=run(s,'payment.completeTest',{orderId:order.id,outcome});
        assert.equal(s.payments.length,outcome==='Success'?1:0);
    }
    assert.equal(dueFor(s,st),initial-12345);assert.match(s.payments[0].receipt,/^TEST-/);
});
test('portal reads contain only linked students and published marks; writes cannot cross scope',()=>{
    const s=createSeed(),linked=s.students[1],other=s.students[2],parent={userId:'parent_one',studentIds:[linked.id]};
    s.marks.cs201.status='Locked';s.marks.cs202.status='Submitted';
    const view=scopeState(s,'parent',parent);
    assert.deepEqual(view.students.map(st=>st.id),[linked.id]);assert.deepEqual(Object.keys(view.marks),['cs201']);assert.deepEqual(Object.keys(view.marks.cs201.rows),[linked.id]);
    assert.deepEqual(view.audit,[]);assert.deepEqual(view.operations,[]);
    assert.throws(()=>run(s,'fees.pay',{studentId:linked.id,amount:1},'parent',parent),e=>e.status===403);
    assert.throws(()=>run(s,'payment.order',{studentId:other.id,amount:1},'parent',parent),e=>e.status===403);
    assert.equal(record(run(s,'payment.order',{studentId:linked.id,amount:1},'parent',parent),'order').createdBy,parent.userId);
});
test('admission confirmation requires document verification and creates one stable enrolment',()=>{
    let s=createSeed();s=run(s,'admission.create',{reference:'APP-001',name:'Synthetic Applicant',roll:'ENG-24-CSE-0999',email:'synthetic@example.test',programme:s.settings.programme});let admission=record(s,'admission');
    assert.throws(()=>run(s,'admission.transition',{id:admission.id,baseVersion:1,status:'Documents verified',reason:'Review complete'}),/Verify at least/);
    s=run(s,'document.add',{admissionId:admission.id,name:'test.pdf',objectKey:'documents/test/file',contentType:'application/pdf',size:123});const doc=record(s,'document');
    s=run(s,'document.review',{id:doc.id,baseVersion:1,status:'Verified',reason:'Synthetic document checked'});
    for(const status of ['Documents verified','Offered','Confirmed']) {admission=record(s,'admission');s=run(s,'admission.transition',{id:admission.id,baseVersion:admission.version,status,reason:'Approved for synthetic demo'});}
    assert.equal(s.students.length,25);assert.ok(record(s,'admission').data.studentId);assert.equal(s.students.at(-1).baseline,null);
    assert.throws(()=>run(s,'admission.transition',{id:admission.id,baseVersion:4,status:'Confirmed',reason:'Repeated confirmation'}),/not allowed/);
});
test('leave decisions reject self-approval and overlapping requests',()=>{
    let s=createSeed();s=run(s,'leave.request',{start:'2026-12-01',end:'2026-12-03',reason:'Personal leave'});const request=record(s,'leave');
    assert.throws(()=>run(s,'leave.decide',{id:request.id,baseVersion:1,status:'Approved',reason:'Self approval'}),e=>e.status===403);
    assert.throws(()=>run(s,'leave.request',{start:'2026-12-02',end:'2026-12-04',reason:'Overlap'}),/overlaps/);
    s=run(s,'leave.decide',{id:request.id,baseVersion:1,status:'Approved',reason:'Coverage arranged'},'admin',{userId:'admin_two'});
    assert.equal(record(s,'leave').data.status,'Approved');
});
test('reminders deduplicate daily runs and suppress cleared balances or withdrawn consent before test delivery',()=>{
    let s=createSeed();const st=s.students.find(st=>st.openingDue>0);
    s=run(s,'consent.record',{studentId:st.id,purpose:'fee-reminders',status:'Granted',noticeVersion:'v1',evidence:'Synthetic recorded consent'});
    s=run(s,'jobs.run');const count=erpRecords(s,'message').length;s=run(s,'jobs.run');assert.equal(erpRecords(s,'message').length,count);
    const message=erpRecords(s,'message').find(r=>r.data.studentId===st.id&&r.data.type==='dues');assert.equal(message.data.status,'Queued (test)');
    s=run(s,'fees.pay',{studentId:st.id,amount:dueFor(s,st)});s=run(s,'messages.deliverTest');
    assert.equal(erpRecords(s,'message').find(r=>r.id===message.id).data.status,'Suppressed');
    assert.ok(!erpRecords(s,'message').some(r=>r.data.status==='Delivered (test)'));
});
test('bank matching requires exact amount and one receipt per credit',()=>{
    let s=createSeed(),st=s.students.find(st=>st.openingDue>0);s=run(s,'fees.pay',{studentId:st.id,amount:10000});
    const rows=[{reference:'TEST-001',amount:10000,date:todayIST(),description:'Synthetic credit'}];s=run(s,'bank.import',{rows});s=run(s,'bank.import',{rows});assert.equal(erpRecords(s,'bank').length,1);
    const bank=record(s,'bank');s=run(s,'bank.match',{id:bank.id,baseVersion:1,paymentId:s.payments[0].id,reason:'Exact reference verified'});
    assert.equal(record(s,'bank').data.status,'Matched');assert.equal(s.payments.length,1);
    assert.throws(()=>run(s,'bank.import',{rows:[{...rows[0],amount:20000}]}),e=>e.status===409);
});
test('cancelled scheduled periods leave the missing list and attendance denominator',()=>{
    let s=createSeed();const st=s.students[0],date=todayIST();s=run(s,'period.save',{subjectId:'cs201',date,period:1,status:'Scheduled',baseVersion:0});assert.equal(missingPeriods(s).length,1);
    s=run(s,'attendance.save',{subjectId:'cs201',date,period:1,baseVersion:0,entries:Object.fromEntries(s.students.map(st=>[st.id,true]))});assert.equal(missingPeriods(s).length,0);assert.equal(attendanceRate(s,st),100);
    s=run(s,'period.save',{subjectId:'cs201',date,period:1,status:'Cancelled',baseVersion:1,reason:'Class cancelled by office'});assert.equal(attendanceRate(s,st),null);
    assert.throws(()=>run(s,'attendance.save',{subjectId:'cs201',date,period:1,baseVersion:1,entries:{}}),/cancelled/);
});
test('absent marks are distinct from zero and export snapshots survive later reopening',()=>{
    let s=createSeed();const rows=Object.fromEntries(s.students.map(st=>[st.id,{test:-1,assignment:0,practical:10}]));
    s=run(s,'marks.save',{subjectId:'cs201',baseVersion:0,rows});assert.equal(markTotal(s.marks.cs201.rows[s.students[0].id]),10);
    s=run(s,'marks.submit',{subjectId:'cs201',baseVersion:1});s=run(s,'marks.lock',{subjectId:'cs201',baseVersion:2});
    s=run(s,'marks.export',{subjectId:'cs201',baseVersion:3});const exported=structuredClone(record(s,'markExport'));
    s=run(s,'marks.reopen',{subjectId:'cs201',baseVersion:3,reason:'Approved correction'});assert.deepEqual(record(s,'markExport'),exported);
    assert.throws(()=>run(s,'marks.export',{subjectId:'cs201',baseVersion:3}),/current locked/);
});
test('assessment configuration rejects totals other than 40 and values below existing marks',()=>{
    const s=createSeed(),payload={baseVersion:0,batch:'2024–2028',semester:'Semester 3',academicYear:'2026–27',test:20,assignment:10,practical:10};
    assert.throws(()=>run(s,'settings.save',{...payload,test:21}),/total 40/);
    assert.throws(()=>run(s,'settings.save',{...payload,test:10,assignment:20}),/exceed/);
    const next=run(s,'settings.save',payload);assert.equal(next.settings.configurationVersion,1);assert.equal(next.marks.cs201.version,1);
});
