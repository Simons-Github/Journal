import { ReactNode, useEffect, useLayoutEffect, useRef } from 'react'

import { useLocation } from 'react-router'
import { CalendarRange, Moon, Sun } from 'lucide-react'
import { navFor } from '../nav'
import { t } from '../i18n'

/**
 * Seitenkopf: ruhiger Serifentitel, darunter eine kurze Beschreibung.
 * Ohne eigene Beschreibung (children) wird die aus der Navigation genommen.
 */
export function PageHeader({ title, children }: { icon?: string; title: string; cover?: string; children?: ReactNode }) {
  const { pathname } = useLocation()
  const nav = navFor(pathname)
  const isNavPage = nav?.to === pathname
  const entry = /^\/(morgen|abend|woche)\/./.exec(pathname)?.[1]
  const EntryIcon = entry === 'morgen' ? Sun : entry === 'abend' ? Moon : CalendarRange
  return (
    <header className="page-header">
      {entry && (
        <div className="entry-badge"><EntryIcon size={15} strokeWidth={2} />{entry === 'morgen' ? 'Morning Journal' : entry === 'abend' ? 'Evening Journal' : 'Weekly Review'}</div>
      )}
      {title && <h1 className="page-title">{title}</h1>}
      {children ?? (isNavPage && <p className="lead">{t(nav.description)}</p>)}
    </header>
  )
}

/** Abschnitt mit Überschrift; `plain` lässt den Kasten weg (für ruhigere Bereiche) */
export function Section({ title, actions, children, className = '', plain = false }: { title: string; icon?: string; actions?: ReactNode; children: ReactNode; className?: string; plain?: boolean }) {
  return (
    <section className={`${plain ? 'section-plain' : 'card'} ${className}`}>
      <div className="card-head">
        <h2 className="section-title">{t(title)}</h2>
        {actions && <div className="card-actions">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(tab => (
        <button key={tab} role="tab" aria-selected={tab === value} className={tab === value ? 'tab active' : 'tab'} onClick={() => onChange(tab)}>
          {t(tab)}
        </button>
      ))}
    </div>
  )
}

export function Check({ checked, onChange, label, strike = true }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; strike?: boolean }) {
  return (
    <label className={`check ${checked && strike ? 'is-done' : ''}`}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="box" aria-hidden>{checked ? '✓' : ''}</span>
      {label !== undefined && <span className="check-label">{label}</span>}
    </label>
  )
}

export function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <span className="stars" aria-label={t('{n} von 5 Sternen', { n: value })}>
      {[1, 2, 3, 4, 5].map(i => onChange ? (
        <button key={i} type="button" className={i <= value ? 'star on' : 'star'} aria-label={t('{n} Sterne', { n: i })}
          onClick={e => { e.stopPropagation(); onChange(i === value ? 0 : i) }}>★</button>
      ) : (
        <span key={i} className={i <= value ? 'star on' : 'star'} aria-hidden>★</span>
      ))}
    </span>
  )
}

export function Pill({ children, tone = 'gray' }: { children: ReactNode; tone?: string }) {
  return <span className={`pill tone-${tone}`}>{children}</span>
}

export const statusTone: Record<string, string> = {
  'To Do': 'red', Doing: 'orange', Done: 'green', 'On Hold': 'gray',
  Hoch: 'red', Mittel: 'orange', Gering: 'green',
  Idee: 'gray', 'Am Lesen': 'orange', Fertig: 'green',
}

export function Progress({ value }: { value: number }) {
  return (
    <span className="progress">
      <span className="bar"><span style={{ width: `${Math.min(100, value)}%` }} /></span>
      <span className="pct">{value} %</span>
    </span>
  )
}

export function AutoText({ value, onChange, placeholder, className = '', minRows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [value])
  return <textarea ref={ref} rows={minRows} className={`autotext ${className}`} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
}

export function Modal({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal>
        <button className="modal-close" onClick={onClose} aria-label={t('Schließen')}>×</button>
        {children}
      </div>
    </div>
  )
}

export function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="prop">
      <div className="prop-label">{label}</div>
      <div className="prop-value">{children}</div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{typeof children === 'string' ? t(children) : children}</div>
}

export function AddRow({ onClick, children = 'Neu' }: { onClick: () => void; children?: ReactNode }) {
  return <button className="add-row" onClick={onClick}>+ {typeof children === 'string' ? t(children) : children}</button>
}
