'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Workspace, WorkspaceAccess, WorkspaceResponse, StaffMember, Command, QueuedAttendance } from './types';
import { readLocal, writeLocal, clearOwnerLocal, clearOfflineShell, cacheRoster, rosterKey, type CachedRoster, listQueue, enqueue, removeLocal } from './offline';

export function useWorkspace(owner: string | null, localDemo = false) {
    const [state, setState] = useState<Workspace | null>(null);
    const [access, setAccess] = useState<WorkspaceAccess | null>(null), [staff, setStaff] = useState<StaffMember[]>([]);
    const [workspaces, setWorkspaces] = useState<WorkspaceResponse['workspaces']>([]);
    const [localAccounts, setLocalAccounts] = useState<NonNullable<WorkspaceResponse['localAccounts']>>([]);
    const [workspaceId, setWorkspaceId] = useState('');
    const [online, setOnline] = useState(true), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [syncing, setSyncing] = useState(false);
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [queue, setQueue] = useState<QueuedAttendance[]>([]), [cached, setCached] = useState(false);
    const [sessionEnded, setSessionEnded] = useState(false);
    const sessionClosed = useRef(false);
    const syncLock = useRef(false), generation = useRef(0), refreshRef = useRef<() => Promise<void>>(async () => {});
    const role = access?.role ?? 'faculty';
    const notify = useCallback((message: string) => setNotice(message), []);
    useEffect(() => { if (notice) { const t = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(t); } }, [notice]);
    const reloadQueue = useCallback(async () => { setQueue(owner ? await listQueue(owner) : []); }, [owner]);
    const accept = useCallback((body: WorkspaceResponse) => {
        if (body.owner !== owner) throw new Error('The signed-in account changed. Reload to continue with that account.');
        setState(body.state); setAccess(body.access); setStaff(body.staff); setWorkspaces(body.workspaces);
        setLocalAccounts(body.localAccounts ?? []); setCached(false); setError('');
        try { localStorage.setItem(`campus-workspace:${owner}`, body.access.workspaceId); } catch { /* Offline persistence is checked separately. */ }
    }, [owner]);
    const refresh = useCallback(async () => {
        const current = ++generation.current;
        if (!owner || sessionClosed.current) { setState(null); setAccess(null); setLoading(false); return; }
        let selected = workspaceId;
        if (!selected) { try { selected = localStorage.getItem(`campus-workspace:${owner}`) ?? ''; } catch {} }
        let mayUseCache = true;
        try {
            const response: Response = await fetch('/api/workspace', { headers: selected ? { 'x-workspace-id': selected } : {}, cache: 'no-store', signal: AbortSignal.timeout(12000) });
            mayUseCache = response.status >= 500;
            const body = await response.json() as WorkspaceResponse & { error: string };
            if (current !== generation.current) return;
            if (response.status === 401 || (response.ok && body.owner !== owner)) {
                mayUseCache = false;
                sessionClosed.current = true; setSessionEnded(true);
            }
            if (!response.ok) throw new Error(body.error);
            accept(body);
            await cacheRoster(body).catch(() => notify('Device storage is unavailable. Offline attendance cannot be saved on this browser.'));
        } catch (e) {
            if (current !== generation.current) return;
            const saved = mayUseCache && selected ? await readLocal<CachedRoster>(rosterKey(owner, selected)).catch(() => undefined) : undefined;
            if (current !== generation.current) return;
            if (saved && saved.owner === owner && saved.access.workspaceId === selected && ['admin', 'faculty'].includes(saved.access.role)) {
                setState(saved.state); setAccess(saved.access); setWorkspaces(saved.workspaces); setStaff([]); setCached(true);
                setError('Showing the roster saved on this device. Attendance is available offline.');
            } else {
                setState(null); setAccess(null); setStaff([]); setCached(false);
                if (!mayUseCache && selected) await removeLocal(rosterKey(owner, selected)).catch(() => {});
                setError(e instanceof Error ? e.message : 'Could not load workspace.');
            }
        } finally {
            if (current === generation.current) { setLoading(false); await reloadQueue().catch(() => {}); }
        }
    }, [owner, workspaceId, accept, reloadQueue, notify]);
    refreshRef.current = refresh;
    useEffect(() => { setLoading(true); setState(null); setAccess(null); void refresh(); return () => { generation.current++; }; }, [refresh]);
    const sync = useCallback(async () => {
        if (!owner || sessionClosed.current || syncLock.current || !navigator.onLine) return;
        syncLock.current = true; setSyncing(true);
        try {
            for (const item of await listQueue(owner)) {
                if (item.status !== 'pending') continue;
                if (!item.workspaceId) {
                    await writeLocal(`queue:${item.command.id}`, { ...item, status: 'rejected', error: 'This older draft has no campus identity. Retain it for review; it cannot be sent automatically.' });
                    continue;
                }
                try {
                    const response: Response = await fetch('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-workspace-id': item.workspaceId, 'x-expected-user': owner }, body: JSON.stringify(item.command), signal: AbortSignal.timeout(15000) });
                    const body = await response.json() as WorkspaceResponse & { error: string };
                    if (!response.ok) {
                        if (response.status === 401 || response.status >= 500) { setError(body.error); break; }
                        await writeLocal(`queue:${item.command.id}`, { ...item, status: response.status === 409 ? 'conflict' : 'rejected', error: body.error });
                        continue;
                    }
                    if (body.owner !== owner || body.access?.workspaceId !== item.workspaceId) break;
                    await removeLocal(`queue:${item.command.id}`);
                } catch { break; }
            }
            await reloadQueue(); await refreshRef.current();
        } catch { setError('Device storage is unavailable. Pending attendance could not be read.'); }
        finally { syncLock.current = false; setSyncing(false); }
    }, [owner, reloadQueue]);
    useEffect(() => {
        const changed = (event: StorageEvent) => {
            if (event.key !== 'campus-session-change' || !event.newValue) return;
            // Immediately hide the previous account in other tabs; keep its outbox recoverable.
            sessionClosed.current = true; generation.current++;
            setState(null); setAccess(null); setStaff([]); setSessionEnded(true);
        };
        window.addEventListener('storage', changed);
        return () => window.removeEventListener('storage', changed);
    }, []);
    useEffect(() => {
        setOnline(navigator.onLine);
        const on = () => { setOnline(true); void sync(); }, off = () => setOnline(false), focus = () => { if (navigator.onLine) void sync(); };
        window.addEventListener('online', on); window.addEventListener('offline', off); window.addEventListener('focus', focus);
        const interval = setInterval(() => { if (navigator.onLine) void sync(); }, 45000);
        if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production')
            navigator.serviceWorker.register('/sw.js').then(async () => {
                const registration = await navigator.serviceWorker.ready;
                const urls = performance.getEntriesByType('resource').map(entry => entry.name).filter(url => { const u = new URL(url); return u.origin === location.origin && /\.(js|css|svg)$/.test(u.pathname); });
                registration.active?.postMessage({ type: 'PREPARE_OFFLINE', urls });
            }).catch(() => notify('Offline shell could not be prepared. Keep this tab open while taking attendance.'));
        void sync();
        return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('focus', focus); clearInterval(interval); };
    }, [sync, notify]);
    async function mutate(type: string, payload: Record<string, any>, message = 'Changes saved', operationId = crypto.randomUUID()) {
        if (!owner || sessionClosed.current || !access || !navigator.onLine || cached) throw new Error('Reconnect and sign in before changing these records.');
        const current = generation.current;
        setBusy(true);
        try {
            const response: Response = await fetch('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-workspace-id': access.workspaceId, 'x-expected-user': owner }, body: JSON.stringify({ id: operationId, type, payload }), signal: AbortSignal.timeout(15000) });
            const body = await response.json() as WorkspaceResponse & { error: string };
            if (!response.ok) { if (response.status === 401 || response.status === 403) void refresh(); throw new Error(body.error); }
            if (current === generation.current) { accept(body); await cacheRoster(body).catch(() => {}); }
            if (type === 'workspace.create') setWorkspaceId(body.access.workspaceId);
            notify(message); return body.state as Workspace;
        } finally { setBusy(false); }
    }
    async function saveAttendance(command: Command, draftKey: string) {
        if (!owner || sessionClosed.current || !access) throw new Error('Sign in and open an assigned campus first.');
        const existing = await listQueue(owner);
        if (existing.some(q => q.workspaceId === access.workspaceId && q.command.payload.subjectId === command.payload.subjectId && q.command.payload.date === command.payload.date && q.command.payload.period === command.payload.period))
            throw new Error('This class already has a pending save. Sync or resolve it before saving again.');
        await enqueue({ command, owner, workspaceId: access.workspaceId, role, status: 'pending' }, draftKey);
        await reloadQueue(); notify('Saved on this device. Waiting for server confirmation.'); void sync();
    }
    async function switchLocalAccount(userId: string) {
        if (!localAccounts.some(a => a.userId === userId) || syncing || busy) return;
        try {
            // A full reload also clears all component state from the previous account.
            sessionStorage.setItem('campus-local-account', userId);
            const response = await fetch('/api/demo/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
            if (!response.ok) throw new Error('Could not switch the local preview account.');
            try { localStorage.setItem('campus-session-change', crypto.randomUUID()); } catch {}
            window.location.reload();
        } catch (e) { try { sessionStorage.setItem('campus-local-account', owner ?? 'local_demo'); } catch {} notify((e as Error).message); }
    }
    async function signOut(discardPending = false) {
        if (!owner || syncing || busy) return;
        // Invalidate in-flight reads before removing their account's cached data.
        sessionClosed.current = true; generation.current++;
        try {
            await clearOwnerLocal(owner, discardPending);
            await clearOfflineShell();
        } catch (error) { sessionClosed.current = false; throw error; }
        setState(null); setAccess(null);
        try { localStorage.setItem('campus-session-change', crypto.randomUUID()); } catch {}
        try { localStorage.removeItem(`campus-workspace:${owner}`); sessionStorage.removeItem('campus-local-account'); } catch {}
        if (localDemo) {
            const response = await fetch('/api/demo/account', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signOut:true})});
            if (!response.ok) throw new Error('Local sign-out failed. Your device cache was cleared.');
            window.location.replace('/');
        } else window.location.assign('/signout-with-chatgpt?return_to=%2Flogin');
    }
    return { signOut, sessionEnded, state, role, access, staff, workspaces, localAccounts, setWorkspaceId, switchLocalAccount, online, loading, busy, syncing, error, setError, notice, queue, cached, refresh, mutate, notify, sync, saveAttendance, reloadQueue, owner };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
