'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X, Search, ArrowUpRight, Inbox } from './icons';
export const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);
export const initials = (name: string) => name.split(' ').slice(0, 2).map(s => s[0]).join('');
export function Badge({ children, tone = 'neutral' }: {
    children: ReactNode;
    tone?: string;
}) { return <span className={`badge ${tone}`}><span className="badge-dot"/>{children}</span>; }
export function Avatar({ name, index = 0 }: {
    name: string;
    index?: number;
}) { return <span className={`avatar avatar-${index % 5}`}>{initials(name)}</span>; }
export function Empty({ title, children }: {
    title: string;
    children?: ReactNode;
}) { return <div className="empty"><span className="empty-icon"><Inbox size={23}/></span><h3>{title}</h3><p>{children}</p></div>; }
export function SearchBox({ value, onChange, placeholder = 'Search students…' }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}) { return <label className="search-box"><Search size={16}/><input aria-label={placeholder} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}/></label>; }
export function SectionHead({ title, subtitle, action }: {
    title: string;
    subtitle?: string;
    action?: ReactNode;
}) { return <div className="section-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>; }
export function Stat({ label, value, hint, icon, tone = '' }: {
    label: string;
    value: ReactNode;
    hint: ReactNode;
    icon: ReactNode;
    tone?: string;
}) { return <div className={`stat-card ${tone}`}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value}</strong><div className="stat-hint">{hint}</div></div>; }
export function LinkButton({ children, onClick }: {
    children: ReactNode;
    onClick: () => void;
}) { return <button className="text-button" onClick={onClick}>{children}<ArrowUpRight size={15}/></button>; }
export function Modal({ title, children, onClose, wide = false }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
    wide?: boolean;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement, old = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        ref.current?.focus();
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape')
            onClose(); if (e.key === 'Tab') {
            const list = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? []);
            const first = list[0], last = list.at(-1);
            if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
                e.preventDefault();
                last?.focus();
            }
            else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
            }
        } };
        document.addEventListener('keydown', key);
        return () => { document.body.style.overflow = old; document.removeEventListener('keydown', key); previous?.focus(); };
    }, [onClose]);
    return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget)
        onClose(); }}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide ? 'wide' : ''}`}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</div></div>;
}
