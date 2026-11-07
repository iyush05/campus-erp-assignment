import { openDatabase, sqliteDatabase } from './sqlite-database.mjs';
import { bootstrapWorkspace, readSnapshot, publicResponse } from '../lib/server/repository.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
const count=Number(process.argv[2] || 7800),reads=Number(process.argv[3] || 12);
if(!Number.isInteger(count)||count<24||count>10000||!Number.isInteger(reads)||reads<1||reads>100)throw new Error('Use 24–10000 students and 1–100 reads.');
const sqlite=openDatabase(':memory:'),db=sqliteDatabase(sqlite),owner={userId:'scale_test_admin',displayName:'Synthetic Scale Admin'};
try {
    await bootstrapWorkspace(db,owner);
    const student=sqlite.prepare('INSERT INTO campus_students (workspace_id,id,name,roll,year,section,category,baseline_held,baseline_present,legacy_attendance,opening_due,synthetic) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    const marks=sqlite.prepare('INSERT INTO mark_entries VALUES (?,?,?,?,?,?)');
    sqlite.exec('BEGIN');
    for(let i=24;i<count;i++){
        const id=`load-${i}`;student.run('engineering-cse',id,`Synthetic Student ${i}`,`LOAD-${i}`,2,'A','General',40,30,null,100000,1);
        for(const subject of ['cs201','cs202','cs203','cs204'])marks.run('engineering-cse',subject,id,15,8,8);
    }
    sqlite.exec('COMMIT');
    const timings=[];let bytes=0;
    for(let i=0;i<reads;i++){
        const started=performance.now();const body=publicResponse(await readSnapshot(db,owner.userId));
        const encoded=JSON.stringify(body);bytes=Buffer.byteLength(encoded);if(body.state.students.length!==count)throw new Error('Row count mismatch');timings.push(performance.now()-started);
    }
    timings.sort((a,b)=>a-b);
    const result={kind:'In-process SQLite repository benchmark; not a concurrent HTTP/device load test',students:count,serialReads:reads,p95Ms:Math.round(timings[Math.ceil(reads*.95)-1]),responseBytes:bytes,node:process.version,platform:process.platform,arch:process.arch,at:new Date().toISOString()};
    mkdirSync('outputs',{recursive:true});writeFileSync('outputs/scale-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally { sqlite.close(); }
