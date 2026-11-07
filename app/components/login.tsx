'use client';
import { useState } from 'react';
import { ArrowRight, BookOpen, GraduationCap, ShieldCheck, Users } from './icons';
import { frameworkAccounts } from '../../lib/local-accounts';
import type { Role } from '../../lib/types';

export type LocalLogin = 'framework' | 'preview' | undefined;
const choices = [
    { role: 'student', name: 'Student', detail: 'Your attendance, results and fees', icon: GraduationCap },
    { role: 'faculty', name: 'Teacher', detail: 'Your classes, marks and mentor tasks', icon: BookOpen },
    { role: 'admin', name: 'Office admin', detail: 'Admissions, accounts and campus setup', icon: ShieldCheck },
    { role: 'parent', name: 'Parent', detail: 'Stay connected to your student’s progress', icon: Users },
] as const;

export function Login({ localMode }: { localMode?: LocalLogin }) {
    const [role, setRole] = useState<Role>('student'), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const selected = choices.find(choice => choice.role === role)!;
    const account = frameworkAccounts.find(account => account.role === role)!;
    const signIn = '/signin-with-chatgpt?return_to=%2F' + (localMode === 'framework' ? `&account=${account.userId}` : '');
    async function previewSignIn() {
        setBusy(true); setError('');
        try {
            const userId = role === 'admin' ? 'local_demo' : account.userId;
            const response = await fetch('/api/demo/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
            if (!response.ok) throw new Error('Sign-in could not be completed. Please try again.');
            try { sessionStorage.setItem('campus-local-account', userId); } catch {}
            window.location.replace('/');
        } catch (error) { setError((error as Error).message); setBusy(false); }
    }
    return <main className="login-page">
        <section className="login-story" aria-label="Welcome to Campus">
            <a href="/" className="brand"><img src="/favicon.svg" alt=""/><span>campus<span className="brand-dot">.</span></span></a>
            <div className="login-intro"><span className="eyebrow">YOUR CAMPUS, CONNECTED</span><h1>A place for <br/>every part of <br/>your campus.</h1><p>One place to learn, teach and keep the day moving.</p><div className="login-illustration" aria-hidden="true"><GraduationCap size={76}/><div><strong>Learning comes first.</strong><span>We’ll take care of the records.</span></div></div></div>
            <small>Attendance · Academics · Student services</small>
        </section>
        <section className="login-form-panel" aria-labelledby="login-title">
            <div className="login-card"><div className="eyebrow">WELCOME BACK</div><h2 id="login-title">Sign in to Campus</h2><p>Choose your workspace to get started.</p>
                <fieldset className="login-roles"><legend>I’m signing in as a</legend>{choices.map(choice => <label key={choice.role} className={`login-role ${role === choice.role ? 'selected' : ''}`}><input type="radio" name="login-role" value={choice.role} checked={role === choice.role} onChange={() => setRole(choice.role)} disabled={busy}/><choice.icon size={22}/><span><strong>{choice.name}</strong><small>{choice.detail}</small></span></label>)}</fieldset>
                {error && <p className="form-error" role="alert">{error}</p>}
                {localMode === 'preview' ? <button className="button primary login-submit" disabled={busy} onClick={() => void previewSignIn()}>{busy ? 'Signing in…' : `Continue as ${selected.name}`}<ArrowRight size={18}/></button> : <a className="button primary login-submit" href={signIn} target="_top">{localMode ? `Continue as ${selected.name}` : 'Continue with ChatGPT'}<ArrowRight size={18}/></a>}
                <p className="login-note">{localMode ? 'Local development sign-in uses sample accounts. No password is required.' : 'Your campus administrator assigns your access. After sign-in, we open the workspace linked to your account.'}</p>
                <div className="login-help"><ShieldCheck size={18}/><span>{localMode ? 'Hosted accounts use Sign in with ChatGPT.' : 'New here? Sign in, then share your account ID with your campus administrator to get access.'}</span></div>
            </div>
        </section>
    </main>;
}
