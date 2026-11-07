import type { QueuedAttendance, WorkspaceResponse } from './types';
const DB_NAME = 'campus-offline-v1';
async function open() { return new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(DB_NAME, 1); request.onupgradeneeded = () => request.result.createObjectStore('records'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
        let value: T;
        let tx: IDBTransaction;
        try { tx = db.transaction('records', mode); }
        catch (error) { db.close(); reject(error); return; }
        tx.oncomplete = () => { db.close(); resolve(value); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Device storage transaction was aborted.')); };
        try { run(tx.objectStore('records'), result => { value = result; }); }
        catch (error) { tx.abort(); db.close(); reject(error); }
    });
}
export function readLocal<T>(key: string): Promise<T | undefined> {
    return transaction('readonly', (store, result) => { const req = store.get(key); req.onsuccess = () => result(req.result); });
}
export function writeLocal(key: string, value: unknown): Promise<void> {
    return transaction('readwrite', store => { store.put(value, key); });
}
export function removeLocal(key: string): Promise<void> {
    return transaction('readwrite', store => { store.delete(key); });
}
export function enqueue(item: QueuedAttendance, draftKey: string): Promise<void> {
    return transaction('readwrite', store => { store.put(item, `queue:${item.command.id}`); store.delete(draftKey); });
}
export function listQueue(owner: string): Promise<QueuedAttendance[]> {
    return transaction('readonly', (store, result) => {
        const req = store.getAll();
        req.onsuccess = () => result(req.result.filter((r: QueuedAttendance) => r?.command && r.owner === owner));
    });
}
export function downloadQueue(queue: QueuedAttendance[]) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(queue, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'campus-unsynced-attendance.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function rosterKey(owner: string, workspaceId: string) { return `roster:v2:${owner}:${workspaceId}`; }
export type CachedRoster = Pick<WorkspaceResponse, 'state' | 'access' | 'owner' | 'workspaces'>;
export async function cacheRoster(response: WorkspaceResponse) {
    const { state, access, owner, workspaces } = response;
    if (access.role === 'student' || access.role === 'parent') {
        // Portal fees/results require a confirmed server response, not a stripped attendance cache.
        await removeLocal(rosterKey(owner, access.workspaceId));
        return;
    }
    const minimal = { ...state, erp: { records: (state.erp?.records ?? []).filter(r=>r.kind==='period') }, students: state.students.map(s => ({ ...s, openingDue: 0 })), marks: {}, payments: [], tasks: [], audit: [], operations: [] };
    await writeLocal(rosterKey(owner, access.workspaceId), { state: minimal, access, owner, workspaces });
}
export function downloadCSV(filename: string, rows: unknown[][]) {
    const safe = (value: unknown) => { let v = String(value ?? ''); if (/^[=+@\-\t\r]/.test(v))
        v = `'${v}`; return `"${v.replaceAll('"', '""')}"`; };
    const blob = new Blob(['\uFEFF' + rows.map(row => row.map(safe).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function parseCSV(text: string, requiredHeaders = ['roll', 'name', 'programme', 'year', 'due']) {
    const rows: string[][] = [];
    let row: string[] = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            if (quoted && text[i + 1] === '"') {
                cell += '"';
                i++;
            }
            else
                quoted = !quoted;
        }
        else if (c === ',' && !quoted) {
            row.push(cell.trim());
            cell = '';
        }
        else if ((c === '\n' || c === '\r') && !quoted) {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            row.push(cell.trim());
            if (row.some(Boolean))
                rows.push(row);
            row = [];
            cell = '';
        }
        else
            cell += c;
    }
    if (quoted)
        throw new Error('CSV contains an unclosed quote.');
    row.push(cell.trim());
    if (row.some(Boolean))
        rows.push(row);
    const headers = rows.shift()?.map(h => h.replace(/^\uFEFF/, '').toLowerCase()) ?? [];
    for (const required of requiredHeaders)
        if (!headers.includes(required))
            throw new Error(`Missing CSV column: ${required}`);
    return rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
}
export function clearOwnerLocal(owner: string, discardPending = false): Promise<void> {
    return transaction('readwrite', (store) => {
        const req = store.openCursor();
        req.onsuccess = () => {
            const cursor = req.result; if (!cursor) return;
            const key=String(cursor.key),value=cursor.value;
            const owned = value?.owner === owner || [`draft:${owner}:`,`draft:v2:${owner}:`,`roster:${owner}:`,`roster:v2:${owner}:`].some(prefix=>key.startsWith(prefix));
            if (owned) {
                if (value?.command && !discardPending) { store.transaction.abort(); return; }
                cursor.delete();
            }
            cursor.continue();
        };
    });
}
export async function clearOfflineShell() {
    if ('caches' in window) for (const key of await caches.keys()) if (key.startsWith('campus-shell-')) await caches.delete(key);
}
