import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync, constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
const [mode,sourceArg,destinationArg] = process.argv.slice(2);
if (!['create','verify','restore'].includes(mode) || !sourceArg || (mode!=='verify'&&!destinationArg)) throw new Error('Usage: backup.mjs create <database> <new-backup> | verify <database> | restore <backup> <new-database>');
const source=resolve(sourceArg);if(!existsSync(source))throw new Error('Source database does not exist.');
function verify(path) {
    const db=new DatabaseSync(path,{readOnly:true});
    try {
        if(db.prepare('PRAGMA integrity_check').all().some(row=>row.integrity_check!=='ok'))throw new Error('Database integrity check failed.');
        if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Foreign-key check failed.');
        return {workspaces:db.prepare('SELECT COUNT(*) AS count FROM campus_workspaces').get().count,students:db.prepare('SELECT COUNT(*) AS count FROM campus_students').get().count,payments:db.prepare('SELECT COUNT(*) AS count FROM fee_payments').get().count};
    } finally { db.close(); }
}
if(mode==='verify')console.log(JSON.stringify({verified:true,counts:verify(source)}));
else {
    const destination=resolve(destinationArg);if(existsSync(destination))throw new Error('Destination already exists. Restore to a new path and verify it before switching the application.');
    mkdirSync(dirname(destination),{recursive:true});verify(source);
    if(mode==='create') {
        const db=new DatabaseSync(source);try{db.prepare('VACUUM INTO ?').run(destination);}finally{db.close();}
    } else copyFileSync(source,destination,constants.COPYFILE_EXCL);
    console.log(JSON.stringify({mode,destination,verified:true,counts:verify(destination)}));
}
