import { useEffect, useMemo, useState } from 'react'
import { ApiError, getSessions, getTrace, resolveSession } from './api'
import InsightCards from './components/InsightCards'
import SessionList from './components/SessionList'
import SessionMetadata from './components/SessionMetadata'
import TraceView from './components/TraceView'
import { formatSessionDate, normalizeSessionSummaries } from './sessionSummaries'

function parseRoute(hash = window.location.hash) {
  const path = hash.replace(/^#\/?/, '') || 'sessions'
  const match = path.match(/^sessions\/([^/]+)$/)
  return match ? { view: 'detail', sessionId: decodeURIComponent(match[1]) } : { view: 'sessions', sessionId: null }
}

function navigateTo(path) {
  window.location.hash = `/${path}`
}

function dataSourceCopy(apiState) {
  if (apiState === 'connected') return { label: 'Go API data', status: 'Go API connected', detail: 'Using live session records from the protected Go API' }
  if (apiState === 'unauthorized') return { label: 'Sign-in required', status: 'Authentication required', detail: 'Resolve an authenticated application session to view records' }
  if (apiState === 'error') return { label: 'API unavailable', status: 'API unavailable', detail: 'The session service did not return a usable response' }
  return { label: 'Checking session', status: 'Checking application session', detail: 'Resolving authentication before requesting session records' }
}

const DEFAULT_NALA_LABS_ORIGIN = 'http://localhost:5173'

function resolveNalaLabsOrigin(env = import.meta.env) {
  const configuredOrigin = typeof env?.VITE_NALA_LABS_URL === 'string' ? env.VITE_NALA_LABS_URL.trim() : ''
  const candidate = configuredOrigin || DEFAULT_NALA_LABS_ORIGIN

  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return DEFAULT_NALA_LABS_ORIGIN
    return url.origin
  } catch {
    return DEFAULT_NALA_LABS_ORIGIN
  }
}

function resolveNalaLabsLoginUrl(env = import.meta.env) {
  return `${resolveNalaLabsOrigin(env)}/login`
}

function AuthBoundary({ apiState, onRetry }) {
  const isLoading = apiState === 'loading'
  const isUnauthorized = apiState === 'unauthorized'
  const loginUrl = isUnauthorized ? resolveNalaLabsLoginUrl() : null
  const title = isLoading || isUnauthorized ? 'Sign in through Nala Labs' : 'Sessions could not be loaded.'
  const detail = isLoading
    ? 'Your Nala Labs application session is being checked before Trace data can be shown.'
      : isUnauthorized
        ? 'Your Nala Labs application session could not be verified. Sign in through Nala Labs, then try again.'
        : 'The protected Trace session request did not return data. Sign in through Nala Labs, then retry.'
  const actionLabel = isLoading ? 'Retry authentication' : 'Try again'
  return (
    <main className="auth-boundary" aria-labelledby="auth-boundary-title">
      <section className="auth-boundary-panel" role={isLoading ? 'status' : 'alert'} aria-live="polite">
        <p className="eyebrow">Nala Trace access</p>
        <h1 id="auth-boundary-title">{title}</h1>
        <p>{detail}</p>
        {loginUrl && <a className="state-action" href={loginUrl}>Sign in through Nala Labs</a>}
        <button type="button" className="state-action" onClick={onRetry}>{actionLabel}</button>
      </section>
    </main>
  )
}

function Topbar({ route, session, apiState }) {
  const source = dataSourceCopy(apiState)
  return <header className="topbar"><div className="breadcrumb"><span>Nala Trace</span><span>/</span><strong>{route.view === 'detail' ? 'Session detail' : 'Sessions'}</strong></div><div className="topbar-right"><span className={`source-chip ${apiState}`}><span className="pulse-dot" />{source.label}</span>{route.view === 'detail' && <span className="topbar-session">{session?.id}</span>}</div></header>
}

function SessionStats({ sessions }) {
  const tools = sessions.reduce((total, session) => total + session.toolCallCount, 0)
  const attention = sessions.filter((session) => session.status === 'attention').length
  const latest = sessions.reduce((current, session) => {
    if (!current || (session.lastEventTime || 0) > (current.lastEventTime || 0)) return session
    return current
  }, null)
  return <div className="workspace-stats" aria-label="Session summary"><div><span>Sessions</span><strong>{String(sessions.length).padStart(2, '0')}</strong><small>available to this account</small></div><div><span>Tool calls</span><strong>{tools.toLocaleString()}</strong><small>from bounded summaries</small></div><div><span>Needs review</span><strong className={attention ? 'text-amber' : 'text-green'}>{String(attention).padStart(2, '0')}</strong><small>evaluation signal when available</small></div><div><span>Last captured</span><strong>{latest ? formatSessionDate(latest.lastEventAt) : '—'}</strong><small>most recent event</small></div></div>
}

function DataSourceNotice({ apiState }) {
  const source = dataSourceCopy(apiState)
  if (apiState === 'connected') return null
  return <div className="data-source-notice" role="status"><span className="section-label">Data provenance</span><strong>{source.label}</strong><p>{source.detail}. Only the captured records from this source are being presented.</p></div>
}

function SessionStatePanel({ state, onRetry }) {
  if (state === 'loading') return <div className="panel session-state-panel" role="status" aria-live="polite"><strong>Loading authenticated sessions…</strong><span>Resolving your application session, then reading bounded summaries.</span></div>
  if (state === 'unauthorized') return <div className="panel session-state-panel" role="alert"><strong>Sign in to view sessions.</strong><span>Your application session could not be resolved. Sign in, then try again.</span><button type="button" className="state-action" onClick={onRetry}>Try again</button></div>
  return <div className="panel session-state-panel" role="alert"><strong>Sessions could not be loaded.</strong><span>The API returned an error while reading session summaries.</span><button type="button" className="state-action" onClick={onRetry}>Retry request</button></div>
}

function SessionsPage({ sessions, selectedId, onSelect, query, onQueryChange, filter, onFilterChange, sortBy, onSortChange, apiState, onRetry }) {
  const source = dataSourceCopy(apiState)
  return <section className="page-section" aria-labelledby="sessions-title"><div className="page-heading"><div><p className="eyebrow">Session list</p><h1 id="sessions-title">All captured sessions</h1><p>Choose a session to open its detailed conversation, tool calls, trace events, and review signal.</p></div><span className="source-note">Source: {source.label.toLowerCase()}</span></div><DataSourceNotice apiState={apiState} />{apiState === 'connected' ? <><SessionStats sessions={sessions} /><SessionList sessions={sessions} selectedId={selectedId} onSelect={onSelect} query={query} onQueryChange={onQueryChange} filter={filter} onFilterChange={onFilterChange} sortBy={sortBy} onSortChange={onSortChange} /></> : <SessionStatePanel state={apiState} onRetry={onRetry} />}</section>
}

function DetailPage({ session, onBack, apiState }) {
  const source = dataSourceCopy(apiState)
  const statusLabel = session.status === 'attention' ? 'Needs review' : session.status === 'passed' ? 'Passed' : 'Captured'
  return <section className="page-section detail-page" aria-labelledby="detail-title"><button type="button" className="back-button" onClick={onBack}>← <span>All sessions</span></button><div className="detail-heading"><div><p className="eyebrow">Session detail</p><h1 id="detail-title">{session.title || session.id}</h1><p>{session.id} · captured {formatSessionDate(session.firstEventAt)}–{formatSessionDate(session.lastEventAt)}</p></div><div className="detail-heading-meta"><span className="source-note">Source: {source.label.toLowerCase()}</span><span className={`detail-status ${session.status}`}>{session.outcome || statusLabel}</span></div></div><DataSourceNotice apiState={apiState} /><SessionMetadata session={session} /><div className="detail-layout"><TraceView session={session} /><InsightCards insights={session.insights || { metrics: [] }} /></div></section>
}

export default function App() {
  const [route, setRoute] = useState(() => parseRoute())
  const [sessions, setSessions] = useState([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('recent')
  const [apiState, setApiState] = useState('loading')
  const [remoteTrace, setRemoteTrace] = useState(null)

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function loadSessions(isActive = () => true) {
    setApiState('loading')
    resolveSession().then(() => {
      if (!isActive()) return null
      return getSessions()
    }).then((payload) => {
      if (!isActive() || !payload) return
      const normalized = normalizeSessionSummaries(payload)
      setSessions(normalized)
      setApiState('connected')
    }).catch((error) => {
      if (!isActive()) return
      setApiState(error instanceof ApiError && error.status === 401 ? 'unauthorized' : 'error')
    })
  }

  useEffect(() => {
    let active = true
    loadSessions(() => active)
    return () => { active = false }
  }, [])

  const selectedSession = useMemo(() => sessions.find((session) => session.id === route.sessionId), [route.sessionId, sessions])

  useEffect(() => {
    let mounted = true
    if (apiState !== 'connected' || route.view !== 'detail' || !route.sessionId) {
      setRemoteTrace(null)
      return () => { mounted = false }
    }
    getTrace(route.sessionId).then((payload) => {
      if (mounted && payload?.eventsList) setRemoteTrace(payload)
    }).catch(() => {})
    return () => { mounted = false }
  }, [apiState, route.sessionId, route.view])

  const detailSession = selectedSession && remoteTrace ? { ...selectedSession, ...remoteTrace } : selectedSession

  function selectSession(id) {
    navigateTo(`sessions/${encodeURIComponent(id)}`)
  }

  if (apiState !== 'connected') return <AuthBoundary apiState={apiState} onRetry={loadSessions} />

  const showDetail = route.view === 'detail' && apiState === 'connected' && detailSession
  return <div className="app-shell"><main className="main-content"><Topbar route={route} session={selectedSession} apiState={apiState} />{showDetail ? <DetailPage session={detailSession} apiState={apiState} onBack={() => navigateTo('sessions')} /> : <SessionsPage sessions={sessions} selectedId={selectedSession?.id} onSelect={selectSession} query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} sortBy={sortBy} onSortChange={setSortBy} apiState={apiState} onRetry={loadSessions} />}</main></div>
}
