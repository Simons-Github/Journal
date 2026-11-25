import { Fragment, ReactNode, useEffect, useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router'
import { Ellipsis, House, ListChecks, Monitor, Moon, Repeat, Settings as SettingsIcon, Sun, Sunrise, X } from 'lucide-react'
import { StoreProvider } from './store'
import { EditorProvider } from './components/Editor'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Assistant } from './components/Assistant'
import Dashboard from './pages/Dashboard'
import GoalSetting from './pages/GoalSetting'
import AreasResources, { AreaPage } from './pages/AreasResources'
import ProjectHub from './pages/ProjectHub'
import BrainFog from './pages/BrainFog'
import { DayPage, EveningList, EveningPage, MorningList, WeekList, WeekPage } from './pages/Journal'
import HabitTracker from './pages/HabitTracker'
import NotesManager from './pages/NotesManager'
import TodoManager from './pages/TodoManager'
import School from './pages/School'
import Books from './pages/Books'
import Settings from './pages/Settings'
import { HOME, NAV } from './nav'
import { SyncProvider, statusLabel, useSync } from './sync'
import { ThemeMode, ThemeProvider, useTheme } from './theme'
import { LANGS, LangProvider, locale, t, useLang } from './i18n'

const THEMES: { mode: ThemeMode; icon: typeof Sun; label: string }[] = [
  { mode: 'light', icon: Sun, label: 'Hell' },
  { mode: 'system', icon: Monitor, label: 'Wie System' },
  { mode: 'dark', icon: Moon, label: 'Dunkel' },
]

function ThemeSwitch() {
  const { mode, setMode } = useTheme()
  return (
    <div className="theme-switch" role="radiogroup" aria-label={t('Farbmodus')}>
      {THEMES.map(m => (
        <button key={m.mode} role="radio" aria-checked={mode === m.mode} title={t(m.label)} aria-label={t(m.label)}
          className={mode === m.mode ? 'on' : ''} onClick={() => setMode(m.mode)}>
          <m.icon size={15} strokeWidth={1.8} />
        </button>
      ))}
    </div>
  )
}

/** Sprachwahl: Deutsch oder Englisch, gilt pro Gerät */
function LangSwitch() {
  const { lang, setLang } = useLang()
  return (
    <div className="theme-switch lang-switch" role="radiogroup" aria-label={t('Sprache')}>
      {LANGS.map(l => (
        <button key={l.code} role="radio" aria-checked={lang === l.code} title={l.label} aria-label={l.label}
          className={lang === l.code ? 'on' : ''} onClick={() => setLang(l.code)}>
          {l.short}
        </button>
      ))}
    </div>
  )
}

/** Beim Sprachwechsel alles darunter neu aufbauen, damit jeder Text die neue Sprache bekommt */
function ByLang({ children }: { children: ReactNode }) {
  const { lang } = useLang()
  return <Fragment key={lang}>{children}</Fragment>
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <NavLink to="/" end className="nav-link" onClick={onNavigate}>
        <HOME.icon size={18} strokeWidth={1.8} /><span>{HOME.label}</span>
      </NavLink>
      {NAV.map(g => (
        <div key={g.title} className="nav-group">
          <div className="nav-group-title">{g.title}</div>
          {g.items.map(i => (
            <NavLink key={i.to} to={i.to} className="nav-link" onClick={onNavigate}>
              <i.icon size={18} strokeWidth={1.8} /><span>{i.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </>
  )
}

function SyncFooter({ onNavigate }: { onNavigate?: () => void }) {
  const sync = useSync()
  return (
    <NavLink to="/einstellungen" className="nav-link sync-link" onClick={onNavigate}>
      <SettingsIcon size={18} strokeWidth={1.8} />
      <span className="sync-text">
        <span>Settings</span>
        <span className="sync-state"><span className={`sync-dot s-${sync.status}`} />{sync.auth ? t(statusLabel[sync.status]) : t('Nur auf diesem Gerät')}</span>
      </span>
    </NavLink>
  )
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand" aria-label="Journal – Today">
        <span className="brand-mark" aria-hidden />
        <span className="brand-name">Journal</span>
      </NavLink>
      <nav className="nav" aria-label={t('Hauptnavigation')}><NavList /></nav>
      <div className="sidebar-foot">
        <SyncFooter />
        <div className="switches"><ThemeSwitch /><LangSwitch /></div>
      </div>
    </aside>
  )
}

/** Tab-Leiste unten auf dem Handy, „Mehr“ öffnet die komplette Navigation */
function MobileNav() {
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  const tabs = [
    { to: '/', label: 'Today', icon: House, end: true },
    { to: '/morgen', label: 'Journal', icon: Sunrise, end: false },
    { to: '/todo', label: 'Tasks', icon: ListChecks, end: false },
    { to: '/habits', label: 'Habits', icon: Repeat, end: false },
  ]
  return (
    <>
      <nav className="tabbar" aria-label={t('Schnellnavigation')}>
        {tabs.map(t => (
          <NavLink key={t.to} to={t.to} end={t.end} className="tab-link">
            <t.icon size={21} strokeWidth={1.8} /><span>{t.label}</span>
          </NavLink>
        ))}
        <button className={`tab-link ${open ? 'active' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <Ellipsis size={21} strokeWidth={1.8} /><span>More</span>
        </button>
      </nav>
      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Navigation">
            <div className="sheet-head">
              <span className="brand-name">Journal</span>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label={t('Schließen')}><X size={20} /></button>
            </div>
            <nav className="nav"><NavList onNavigate={() => setOpen(false)} /></nav>
            <div className="sidebar-foot">
              <SyncFooter onNavigate={() => setOpen(false)} />
              <div className="switches"><ThemeSwitch /><LangSwitch /></div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ConflictBanner() {
  const sync = useSync()
  if (!sync.conflict) return null
  return (
    <div className="banner" role="alert">
      <span>{t('Dein Journal wurde am {date} auf einem anderen Gerät geändert. Welchen Stand möchtest du behalten?', { date: new Date(sync.conflict.updatedAt).toLocaleString(locale()) })}</span>
      <span className="banner-actions">
        <button className="btn" onClick={() => sync.resolveConflict('server')}>{t('Stand vom anderen Gerät laden')}</button>
        <button className="btn" onClick={() => sync.resolveConflict('local')}>{t('Meinen Stand behalten')}</button>
      </span>
    </div>
  )
}

function Shell() {
  const loc = useLocation()
  // Neue Seite oben beginnen – außer bei Sprungmarken wie „/einstellungen#ki“
  useEffect(() => { if (!loc.hash) window.scrollTo(0, 0) }, [loc.pathname, loc.hash])
  // Morgen- und Abendseiten bekommen ihre eigene Tageszeit-Farbe
  const tone = loc.pathname.startsWith('/morgen') ? 'morning' : loc.pathname.startsWith('/abend') ? 'evening' : 'day'
  return (
    <div className="shell" data-tone={tone}>
      <Sidebar />
      <div className="main">
        <ConflictBanner />
        <main className="content">
          <ErrorBoundary resetKey={loc.pathname}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/ziele" element={<GoalSetting />} />
              <Route path="/areas" element={<AreasResources />} />
              <Route path="/area/:id" element={<AreaPage />} />
              <Route path="/projekte" element={<ProjectHub />} />
              <Route path="/brain-fog" element={<BrainFog />} />
              <Route path="/morgen" element={<MorningList />} />
              <Route path="/morgen/:id" element={<DayPage />} />
              <Route path="/abend" element={<EveningList />} />
              <Route path="/abend/:id" element={<EveningPage />} />
              <Route path="/woche" element={<WeekList />} />
              <Route path="/woche/:id" element={<WeekPage />} />
              <Route path="/habits" element={<HabitTracker />} />
              <Route path="/notizen" element={<NotesManager />} />
              <Route path="/todo" element={<TodoManager />} />
              <Route path="/studium" element={<School />} />
              <Route path="/buecher" element={<Books />} />
              <Route path="/einstellungen" element={<Settings />} />
              <Route path="*" element={<Dashboard />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
      <MobileNav />
      <Assistant />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <LangProvider>
        <StoreProvider>
          <SyncProvider>
            <ByLang>
              <EditorProvider>
                <Shell />
              </EditorProvider>
            </ByLang>
          </SyncProvider>
        </StoreProvider>
        </LangProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
