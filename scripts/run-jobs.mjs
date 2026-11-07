import { openDatabase, sqliteDatabase } from './sqlite-database.mjs';
import { runDailyJobs } from '../lib/server/jobs.ts';
const path = process.env.CAMPUS_SQLITE_PATH || '.sites-runtime/preview.sqlite';
const actor = process.env.CAMPUS_JOB_ACTOR_ID || 'local_demo';
const sqlite = openDatabase(path);
try { console.log(JSON.stringify({runs:await runDailyJobs(sqliteDatabase(sqlite),actor)})); }
finally { sqlite.close(); }
