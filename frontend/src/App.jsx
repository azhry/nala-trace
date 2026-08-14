import { useEffect, useMemo, useState } from 'react'
import { getHealth, getSessions, getTrace } from './api'
import { currentSessions } from './data/currentSession'
import InsightCards from './components/InsightCards'
import SessionList from './components/SessionList'
import TraceView from './components/TraceView'

function parseRoute(hash = window.location.hash) {
  const path = hash.replace(/^#\/?/, '') || 'sessions'
  const match = path.match(/^sessions\/([^/]+)$/)
  return match ? { view: 'detail', sessionId: decodeURIComponent(match[1]) } : { view: 'sessions', sessionId: null }
}

function navigateTo(path) {
  window.location.hash = `/${path}`
}

function dataSourceCopy(apiState) {
  if (apiState === 'connected') return { label: 'Go API data', status: 'Go API connected', detail: 'Using live session records from the Go API' }
  if (apiState === 'loading') return { label: 'Checking source', status: 'Checking data source', detail: 'Verifying the Go API before describing these records as live' }
  if (apiState === 'unavailable') return { label: 'No data source', status: 'No data source', detail: 'The Go API is unavailable and no audited capture is loaded' }
  return { label: 'Audited capture', status: 'Audited capture loaded', detail: 'Using the real sanitized Codex audit snapshot; the Go API is unavailable' }
}

function Topbar({ route, session, apiState }) {
  const source = dataSourceCopy(apiState)
  return <header className="topbar"><div className="breadcrumb"><span>Nala Trace</span><span>/</span><strong>{route.view === 'detail' ? 'Session detail' : 'Sessions'}</strong></div><div className="topbar-right"><span className={`source-chip ${apiState}`}><span className="pulse-dot" />{source.label}</span>{route.view === 'detail' && <span className="topbar-session">{session?.id}</span>}</div></header>
}

function SessionStats({ sessions }) {
  const tools = sessions.reduce((total, session) => total + (session.toolCalls || 0), 0)
  const attention = sessions.filter((session) => session.status === 'attention').length
  return <div className="workspace-stats" aria-label="Session summary"><div><span>Sessions</span><strong>{String(sessions.length).padStart(2, '0')}</strong><small>captured in this source</small></div><div><span>Tool calls</span><strong>{tools.toLocaleString()}</strong><small>from the complete rollout</small></div><div><span>Needs review</span><strong className={attention ? 'text-amber' : 'text-green'}>{String(attention).padStart(2, '0')}</strong><small>current review signal</small></div><div><span>Last captured</span><strong>{sessions[0]?.capturedAt || '—'}</strong><small>source session timestamp</small></div></div>
}

function DataSourceNotice({ apiState }) {
  const source = dataSourceCopy(apiState)
  if (apiState === 'connected') return null
  return <div className="data-source-notice" role="status"><span className="section-label">Data provenance</span><strong>{source.label}</strong><p>{source.detail}. Only the captured records from this source are being presented.</p></div>
}

function SessionsPage({ sessions, selectedId, onSelect, query, onQueryChange, filter, onFilterChange, apiState }) {
  const source = dataSourceCopy(apiState)
  return <section className="page-section" aria-labelledby="sessions-title"><div className="page-heading"><div><p className="eyebrow">Session list</p><h1 id="sessions-title">All captured sessions</h1><p>Choose a session to open its detailed conversation, tool calls, trace events, and review signal.</p></div><span className="source-note">Source: {source.label.toLowerCase()}</span></div><DataSourceNotice apiState={apiState} /><SessionStats sessions={sessions} /><SessionList sessions={sessions} selectedId={selectedId} onSelect={onSelect} query={query} onQueryChange={onQueryChange} filter={filter} onFilterChange={onFilterChange} /></section>
}

function DetailPage({ session, onBack, apiState }) {
  const source = dataSourceCopy(apiState)
  return <section className="page-section detail-page" aria-labelledby="detail-title"><button type="button" className="back-button" onClick={onBack}>← <span>All sessions</span></button><div className="detail-heading"><div><p className="eyebrow">Session detail</p><h1 id="detail-title">{session.title}</h1><p>{session.id} · captured {session.startedAt}–{session.capturedAt} · {session.duration}</p></div><div className="detail-heading-meta"><span className="source-note">Source: {source.label.toLowerCase()}</span><span className={`detail-status ${session.status}`}>{session.outcome}</span></div></div><DataSourceNotice apiState={apiState} /><div className="detail-layout"><TraceView session={session} /><InsightCards insights={session.insights} /></div></section>
}

export default function App() {
  const [route, setRoute] = useState(() => parseRoute())
  const [sessions, setSessions] = useState(currentSessions)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [apiState, setApiState] = useState('loading')
  const [remoteTrace, setRemoteTrace] = useState(null)

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    let mounted = true
    Promise.all([getHealth(), getSessions()]).then(([health, payload]) => {
      if (health?.status !== 'ok' || !Array.isArray(payload?.sessions)) throw new Error('The Go API did not return a valid session payload')
      if (mounted) {
        setSessions(payload.sessions)
        setApiState('connected')
      }
    }).catch(() => {
      if (mounted) setApiState(currentSessions.length ? 'capture' : 'unavailable')
    })
    return () => { mounted = false }
  }, [])

  const selectedSession = useMemo(() => sessions.find((session) => session.id === route.sessionId) || sessions[0], [route.sessionId, sessions])

  useEffect(() => {
    let mounted = true
    if (route.view !== 'detail' || !route.sessionId) {
      setRemoteTrace(null)
      return () => { mounted = false }
    }
    getTrace(route.sessionId).then((payload) => {
      if (mounted && payload?.eventsList) setRemoteTrace(payload)
    }).catch(() => {})
    return () => { mounted = false }
  }, [route.sessionId, route.view])

  const detailSession = remoteTrace ? { ...selectedSession, ...remoteTrace } : selectedSession

  function selectSession(id) {
    navigateTo(`sessions/${encodeURIComponent(id)}`)
  }

  return <div className="app-shell"><main className="main-content"><Topbar route={route} session={selectedSession} apiState={apiState} />{route.view === 'detail' && detailSession ? <DetailPage session={detailSession} apiState={apiState} onBack={() => navigateTo('sessions')} /> : <SessionsPage sessions={sessions} selectedId={selectedSession?.id} onSelect={selectSession} query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} apiState={apiState} />}</main></div>
}
