import type { ActorScope, Command, Role, Workspace } from './types.ts';
import type { ERPRecord, RecordKind } from './erp-types.ts';
import { DomainError } from './errors.ts';
import { dueFor, evidenceFor, todayIST, attendanceRate } from './domain.ts';
export const erpRecords = (s: Workspace, kind?: RecordKind) => (s.erp?.records ?? []).filter(r => !kind || r.kind === kind);
export const feeAdjustment = (s: Workspace, studentId: string) => erpRecords(s,'fee').filter(r => r.data.studentId === studentId).reduce((sum,r) => sum + r.data.amount,0);
export const cancelledPeriod = (s: Workspace, id: string) => erpRecords(s,'period').some(r => r.id === `period:${id}` && r.data.status === 'Cancelled');
export function missingPeriods(s: Workspace, date = todayIST()) {
    return erpRecords(s,'period').filter(r => r.data.date <= date && r.data.status !== 'Cancelled' && !s.attendance[`${r.data.subjectId}:${r.data.date}:${r.data.period}`]);
}
export function scopeERP(s: Workspace, role: Role, actor: ActorScope) {
    if (role === 'admin') return s.erp ?? {records:[]};
    return { records: erpRecords(s).filter(r => {
        if (r.kind === 'privacy') return r.createdBy === actor.userId;
        if (role === 'faculty') return r.kind === 'markExport' ? !!actor.subjectIds?.includes(r.data.subjectId) : r.kind === 'risk' ? r.createdBy === actor.userId : r.kind === 'leave' ? r.createdBy === actor.userId : r.kind === 'period' && !!actor.subjectIds?.includes(r.data.subjectId);
        if (r.kind === 'fee' || r.kind === 'order') return !!actor.studentIds?.includes(r.data.studentId);
        if (r.kind === 'message') return r.data.status === 'Delivered (test)' && actor.studentIds?.includes(r.data.studentId);
        return r.kind === 'guardian' && r.data.userId === actor.userId;
    }) };
}
function check(ok: unknown, message: string, status = 400): asserts ok { if (!ok) throw new DomainError(message,status); }
const text = (value: unknown, label: string, max = 300) => { check(typeof value === 'string' && value.trim().length >= 2 && value.length <= max, `${label} is required (2–${max} characters).`); return value.trim(); };
const date = (value: unknown) => { check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value, 'Use a valid date.'); return value; };
const money = (value: unknown) => { check(Number.isSafeInteger(value) && Math.abs(value as number) <= 10000000000, 'Amount must be integer paise within the supported limit.'); return value as number; };
export function reminderText(language: 'en' | 'or', type: string, value: number) {
    if (language === 'or') return type === 'dues' ? `ପରୀକ୍ଷା ସନ୍ଦେଶ: ବକେୟା ଶୁଳ୍କ ₹${(value / 100).toFixed(2)}। ଅଧିକ ସୂଚନା ପାଇଁ କାର୍ଯ୍ୟାଳୟ ସହ ଯୋଗାଯୋଗ କରନ୍ତୁ।` : `ପରୀକ୍ଷା ସନ୍ଦେଶ: ଉପସ୍ଥାନ ${value}%। ସହାୟତା ପାଇଁ ଶିକ୍ଷକଙ୍କ ସହ ଯୋଗାଯୋଗ କରନ୍ତୁ।`;
    return type === 'dues' ? `TEST reminder: outstanding fees ₹${(value / 100).toFixed(2)}. Contact the office for details.` : `TEST reminder: attendance is ${value}%. Contact your mentor for support.`;
}
export function applyERPCommand(s: Workspace, command: Command, role: Role, now: string, actor: ActorScope): string {
    const {type,payload:p,id} = command;
    const admin = () => check(role === 'admin','Office admin permission is required.',403);
    const student = (studentId: unknown) => { const found = s.students.find(st => st.id === studentId); check(found,'Student not found.',404); return found; };
    const all = (s.erp ??= {records:[]}).records;
    function add(kind: RecordKind, data: Record<string, any>, recordId = id) {
        check(!all.some(r => r.id === recordId),'This record already exists.',409);
        const record: ERPRecord = {id:recordId,kind,version:1,createdAt:now,updatedAt:now,createdBy:actor.userId ?? 'system',data}; all.push(record); return record;
    }
    function edit(kind: RecordKind, recordId = p.id) {
        const record = all.find(r => r.id === recordId && r.kind === kind); check(record,'Record not found.',404);
        check(record.version === p.baseVersion,'This record changed elsewhere. Refresh before saving.',409); return record;
    }
    function update(r: ERPRecord, data: Record<string, any>) { r.data = {...r.data,...data}; r.version++; r.updatedAt = now; }
    switch(type) {
        case 'settings.save': {
            admin(); check((s.settings.configurationVersion ?? 0) === p.baseVersion,'Settings changed elsewhere.',409);
            const components = {test:Number(p.test),assignment:Number(p.assignment),practical:Number(p.practical)};
            check(Object.values(components).every(n=>Number.isInteger(n)&&n>0&&n<=40)&&Object.values(components).reduce((a,b)=>a+b,0)===40,'The three component maxima must total 40.');
            check(Object.values(s.marks).every(batch=>batch.status==='Draft'),'Reopen all batches before changing assessment settings.');
            check(Object.values(s.marks).every(batch=>Object.values(batch.rows).every(row=>(['test','assignment','practical'] as const).every(key=>row[key]===null||row[key]!<=components[key]))),'Existing marks exceed the proposed maxima. Correct the drafts first.');
            s.settings={...s.settings,batch:text(p.batch,'Batch',100),semester:text(p.semester,'Semester',100),academicYear:text(p.academicYear,'Academic year',100),components,configurationVersion:(s.settings.configurationVersion??0)+1};
            for(const batch of Object.values(s.marks))batch.version++;
            return 'Academic and assessment settings updated';
        }
        case 'payment.order': {
            const st = student(p.studentId); check(role === 'admin' || actor.studentIds?.includes(st.id),'This student is outside your payment access.',403);
            const amount = money(p.amount); check(amount > 0 && amount <= dueFor(s,st),'Payment must be positive and cannot exceed current dues.');
            add('order',{studentId:st.id,amount,status:'Pending',gateway:'Campus Test Gateway',currency:'INR',expiresAt:new Date(Date.parse(now)+15*60000).toISOString(),paymentId:null});
            return `TEST order created for ${amount} paise`;
        }
        case 'payment.completeTest': {
            const r = all.find(r => r.kind === 'order' && r.id === p.orderId); check(r,'Payment order not found.',404);
            check(role === 'admin' || (r.createdBy === actor.userId && actor.studentIds?.includes(r.data.studentId)),'This order belongs to another account.',403);
            check(['Success','Failed','Cancelled'].includes(p.outcome),'Choose a test gateway outcome.');
            if (r.data.status !== 'Pending') return `TEST order already ${r.data.status.toLowerCase()}; no duplicate allocation`;
            check(Date.parse(r.data.expiresAt) >= Date.parse(now),'This test order expired. Create a new order.');
            const st = student(r.data.studentId);
            if (p.outcome === 'Success') {
                check(r.data.amount <= dueFor(s,st),'Balance changed. Create a new order for the remaining dues.');
                const paymentId = `gateway:${r.id}`;
                s.payments.push({id:paymentId,studentId:st.id,amount:r.data.amount,at:now,receipt:`TEST-${String(s.payments.length+1).padStart(5,'0')}`});
                update(r,{status:p.outcome,paymentId});
            } else update(r,{status:p.outcome});
            return `Campus Test Gateway: ${p.outcome}; no real money collected`;
        }
        case 'period.save': {
            admin(); check(s.subjects.some(sub => sub.id === p.subjectId),'Choose a subject.');
            const classDate = date(p.date); check(Number.isInteger(p.period) && p.period >= 1 && p.period <= 8,'Period must be 1–8.');
            check(['Scheduled','Held','Cancelled'].includes(p.status),'Invalid period state.');
            const periodId = `period:${p.subjectId}:${classDate}:${p.period}`;
            const existing = all.find(r => r.id === periodId);
            const data = {subjectId:p.subjectId,date:classDate,period:p.period,status:p.status,reason:p.status === 'Cancelled' ? text(p.reason,'Cancellation reason') : String(p.reason ?? '').slice(0,300)};
            if (existing) update(edit('period',periodId),data); else { check(p.baseVersion === 0,'Refresh the period register.',409); add('period',data,periodId); }
            return `Period ${classDate}/${p.period} set to ${p.status}`;
        }
        case 'feeRule.save': {
            admin(); const amount = money(p.amount); check(amount > 0,'Fee amount must be positive.');
            const data = {name:text(p.name,'Fee name',100),category:text(p.category,'Category',100),amount,dueDate:date(p.dueDate)};
            if (p.id) update(edit('feeRule'),data); else add('feeRule',data);
            return 'Fee structure saved';
        }
        case 'feeRule.assess': {
            admin(); const rule = edit('feeRule'); const period = text(p.term,'Assessment term',100);
            const selected = s.students.filter(st => rule.data.category === 'All' || st.category === rule.data.category);
            check(selected.length,'No students match this category.');
            for (const st of selected) {
                const reference = `${rule.id}:${period}:${st.id}`;
                if (all.some(r => r.kind === 'fee' && r.data.reference === reference)) continue;
                add('fee',{studentId:st.id,amount:rule.data.amount,reason:`${rule.data.name} · ${period}`,category:'Assessment',reference,dueDate:rule.data.dueDate},`${id}:${st.id}`);
            }
            return `Fee assessment applied to ${selected.length} eligible students; duplicates skipped`;
        }
        case 'fee.adjust': {
            admin(); const st = student(p.studentId), amount = money(p.amount); check(amount !== 0,'Enter a non-zero adjustment.');
            check(dueFor(s,st)+amount >= 0,'This concession exceeds the remaining balance.');
            check(['Assessment','Scholarship','Concession','Correction'].includes(p.category),'Choose an adjustment category.');
            check(!['Scholarship','Concession'].includes(p.category) || amount < 0,'Scholarships and concessions must reduce dues.');
            add('fee',{studentId:st.id,amount,reason:text(p.reason,'Approval reason'),category:p.category,reference:id,dueDate:p.dueDate ? date(p.dueDate) : todayIST()});
            return `Approved ${p.category} for ${st.roll}: ${amount} paise`;
        }
        case 'fee.reverse': {
            admin(); const previous = all.find(r => r.kind === 'fee' && r.id === p.id); check(previous,'Adjustment not found.');
            check(!all.some(r => r.kind === 'fee' && r.data.reverses === previous.id),'This adjustment was already reversed.',409);
            const st = student(previous.data.studentId); check(dueFor(s,st)-previous.data.amount >= 0,'Reversal would create an unallocated credit. Reconcile payments first.');
            add('fee',{studentId:st.id,amount:-previous.data.amount,reason:text(p.reason,'Reversal reason'),category:'Correction',reverses:previous.id,reference:id,dueDate:todayIST()});
            return `Reversed adjustment ${previous.id}`;
        }
        case 'admission.create': {
            admin(); const reference = text(p.reference,'Application reference',100);
            check(!all.some(r => r.kind === 'admission' && r.data.reference === reference),'Application reference already exists.',409);
            const programme = text(p.programme,'Programme',100); check(programme === s.settings.programme,'Choose this workspace’s programme. Create a separate workspace for another programme.');
            add('admission',{reference,name:text(p.name,'Applicant name',100),programme,roll:text(p.roll,'Roll number',50),email:text(p.email,'Contact email',200),status:'Applied',studentId:null});
            return `Application ${reference} received`;
        }
        case 'admission.transition': {
            admin(); const r = edit('admission');
            const transitions: Record<string,string[]> = {Applied:['Documents verified','Rejected'], 'Documents verified':['Offered','Rejected'],Offered:['Confirmed','Rejected']};
            check(transitions[r.data.status]?.includes(p.status),'This admission transition is not allowed.');
            const note = text(p.reason,'Decision reason');
            if (p.status === 'Documents verified') check(all.some(d => d.kind === 'document' && d.data.admissionId === r.id && d.data.status === 'Verified'),'Verify at least one uploaded document before proceeding.');
            if (p.status === 'Confirmed') {
                check(!s.students.some(st => st.roll === r.data.roll),'This roll number is already enrolled.');
                check(Object.values(s.marks).every(b => b.status === 'Draft'),'Reopen mark batches before changing the enrolled roster.');
                const studentId = crypto.randomUUID();
                s.students.push({id:studentId,name:r.data.name,roll:r.data.roll,year:s.settings.year ?? 2,section:s.settings.section ?? 'A',category:'General',baseline:null,openingDue:0,synthetic:true});
                for (const batch of Object.values(s.marks)) { batch.rows[studentId]={test:null,assignment:null,practical:null}; batch.version++; }
                r.data.studentId = studentId;
            }
            update(r,{status:p.status,decisionReason:note}); return `Application ${r.data.reference}: ${p.status}`;
        }
        case 'document.add': {
            admin(); check(all.some(r => r.kind === 'admission' && r.id === p.admissionId),'Application not found.');
            check(typeof p.objectKey === 'string' && p.objectKey.startsWith('documents/'),'Use the document upload endpoint.');
            check(Number.isInteger(p.size) && p.size > 0 && p.size <= 2000000,'Document limit is 2 MB.');
            add('document',{admissionId:p.admissionId,name:text(p.name,'Document name',200),objectKey:p.objectKey,contentType:p.contentType,size:p.size,status:'Uploaded'}); return 'Admission document uploaded';
        }
        case 'document.review': {
            admin(); const r = edit('document'); check(['Verified','Rejected'].includes(p.status),'Invalid review result.');
            update(r,{status:p.status,reviewReason:text(p.reason,'Review reason')}); return `Document ${r.data.name}: ${p.status}`;
        }
        case 'guardian.save': {
            admin(); const st = student(p.studentId); check(['en','or'].includes(p.language),'Select English or Odia.');
            const data = {studentId:st.id,userId:String(p.userId ?? '').slice(0,200),name:text(p.name,'Guardian name',100),relationship:text(p.relationship,'Relationship',50),contact:text(p.contact,'Guardian contact',200),language:p.language,birthDate:date(p.birthDate)};
            check(data.birthDate <= todayIST(),'Date of birth cannot be in the future.');
            if (p.id) update(edit('guardian'),data); else add('guardian',data); return `Guardian record updated for ${st.roll}`;
        }
        case 'consent.record': {
            admin(); student(p.studentId); check(['Granted','Withdrawn'].includes(p.status),'Invalid consent state.');
            check(['academic-support','fee-reminders','guardian-contact'].includes(p.purpose),'Choose a defined purpose.');
            add('consent',{studentId:p.studentId,purpose:p.purpose,status:p.status,noticeVersion:text(p.noticeVersion,'Notice version',100),evidence:text(p.evidence,'Consent evidence',500),guardianId:p.guardianId ? String(p.guardianId) : null});
            return `Recorded ${p.status.toLowerCase()} consent for ${p.purpose}`;
        }
        case 'leave.request': {
            check(role === 'faculty' || role === 'admin','Staff access required.',403);
            const start = date(p.start), end = date(p.end); check(start <= end,'End date must follow the start date.');
            check(!all.some(r => r.kind === 'leave' && r.createdBy === actor.userId && ['Requested','Approved'].includes(r.data.status) && r.data.start <= end && r.data.end >= start),'This overlaps an existing leave request.');
            add('leave',{start,end,reason:text(p.reason,'Leave reason'),status:'Requested',staffName:actor.displayName}); return 'Leave request submitted';
        }
        case 'leave.decide': {
            admin(); const r = edit('leave'); check(r.createdBy !== actor.userId,'A different admin must decide your leave request.',403);
            check(r.data.status === 'Requested','This leave request has already been decided.');
            check(['Approved','Rejected'].includes(p.status),'Choose approve or reject.'); update(r,{status:p.status,decision:text(p.reason,'Decision reason'),decidedBy:actor.userId}); return `Leave request ${p.status.toLowerCase()}`;
        }
        case 'privacy.request': {
            const st = student(p.studentId); check(role === 'admin' || actor.studentIds?.includes(st.id),'This student is outside your access.',403);
            check(['Access','Correction','Erasure'].includes(p.requestType),'Choose a request type.');
            add('privacy',{studentId:st.id,type:p.requestType,detail:text(p.detail,'Request details',1000),status:'Open'}); return 'Data request recorded';
        }
        case 'privacy.resolve': {
            admin(); const r = edit('privacy'); check(r.data.status === 'Open','This request is already resolved.');
            check(['Completed','Declined'].includes(p.status),'Choose a resolution.'); update(r,{status:p.status,resolution:text(p.reason,'Resolution details',1000)}); return 'Data request resolved with an audit record';
        }
        case 'bank.import': {
            admin(); check(Array.isArray(p.rows) && p.rows.length > 0 && p.rows.length <= 200,'Import 1–200 statement rows.');
            for (const row of p.rows) {
                const reference = text(row.reference,'Bank reference',100), amount = money(row.amount); check(amount > 0,'Bank credit must be positive.');
                const previous = all.find(r => r.kind === 'bank' && r.data.reference === reference);
                if (previous) { check(previous.data.amount === amount && previous.data.date === date(row.date),'A repeated bank reference has different data.',409); continue; }
                add('bank',{reference,amount,date:date(row.date),description:text(row.description,'Description',200),status:'Unmatched',paymentId:null},`${id}:${all.length}`);
            }
            return `${p.rows.length} test bank statement rows processed`;
        }
        case 'bank.match': {
            admin(); const r = edit('bank'); check(r.data.status === 'Unmatched','This bank credit is already matched.');
            const payment = s.payments.find(payment => payment.id === p.paymentId); check(payment,'Receipt not found.');
            check(payment.amount === r.data.amount,'Receipt and bank credit amounts must match exactly.');
            check(!all.some(row => row.kind === 'bank' && row.data.paymentId === payment.id),'This receipt is already reconciled.');
            update(r,{paymentId:payment.id,status:'Matched',reason:text(p.reason,'Match reason')}); return `TEST bank match recorded for ${payment.receipt}`;
        }
        case 'jobs.run': {
            admin(); const day = todayIST(), key = `job:reminders:${day}`;
            if (all.some(r => r.id === key)) return `Today's reminder run was already recorded`;
            for (const st of s.students) {
                for (const kind of ['dues','attendance']) {
                    const value = kind === 'dues' ? dueFor(s,st) : attendanceRate(s,st);
                    if (value === null || (kind === 'dues' ? value <= 0 : value >= 75)) continue;
                    const guardian = all.find(r => r.kind === 'guardian' && r.data.studentId === st.id);
                    const language = guardian?.data.language === 'or' ? 'or' : 'en';
                    const purpose = kind === 'dues' ? 'fee-reminders' : 'academic-support';
                    const consent = all.filter(r => r.kind === 'consent' && r.data.studentId === st.id && r.data.purpose === purpose).at(-1);
                    const stale = kind === 'attendance' && !Object.values(s.attendance).some(a => a.date >= new Date(Date.parse(now)-14*86400000).toISOString().slice(0,10) && a.entries[st.id] !== undefined);
                    add('message',{studentId:st.id,type:kind,language,text:reminderText(language,kind,value),status:stale || consent?.data.status !== 'Granted' ? 'Suppressed' : 'Queued (test)',reason:stale ? 'Attendance history is stale' : consent?.data.status !== 'Granted' ? 'No current consent for this purpose' : '',value,day},`message:${day}:${kind}:${st.id}`);
                }
            }
            add('job',{type:'Reminders',status:'Completed (test)',day},key); return 'Daily test reminders generated; no external messages sent';
        }
        case 'messages.deliverTest': {
            admin(); let delivered=0;
            for (const r of all.filter(r => r.kind === 'message' && r.data.status === 'Queued (test)')) {
                const st = student(r.data.studentId), value = r.data.type === 'dues' ? dueFor(s,st) : attendanceRate(s,st);
                const consent = all.filter(c => c.kind === 'consent' && c.data.studentId === st.id && c.data.purpose === (r.data.type === 'dues' ? 'fee-reminders' : 'academic-support')).at(-1);
                const stale = r.data.day !== todayIST();
                const suppress = stale || consent?.data.status !== 'Granted' || value === null || (r.data.type === 'dues' ? value <= 0 : value >= 75);
                update(r,{status:suppress ? 'Suppressed' : 'Delivered (test)',reason:suppress ? 'Balance, consent or source freshness changed' : '',...(suppress ? {} : {value,text:reminderText(r.data.language,r.data.type,value!)})});
                if (!suppress) delivered++;
            }
            return `${delivered} reminders delivered to the test inbox only`;
        }
        case 'risk.record': {
            check(role === 'admin' || role === 'faculty','Staff permission required.',403);
            for (const decision of p.decisions) {
                const st = student(decision.studentId);
                const record = add('risk',{studentId:st.id,needsReview:decision.needsReview,explanation:decision.explanation,evidenceIds:decision.evidenceIds,model:p.model,promptVersion:p.promptVersion,sourceRevision:p.sourceRevision},`${id}:${st.id}`);
                if (decision.needsReview && !s.tasks.some(t=>t.studentId===st.id && t.status!=='Closed')) s.tasks.push({id:record.id,studentId:st.id,reason:'AI mentor review',evidence:decision.explanation,status:'Open',mentor:actor.displayName ?? 'Office admin',mentorUserId:actor.userId,at:now});
            }
            return `Validated AI evidence recorded for ${p.decisions.length} students`;
        }
        case 'reports.export': admin(); return `Exported ${text(p.report,'Report name',100)} for this campus`;
        default: throw new DomainError('Unknown operation.');
    }
}
