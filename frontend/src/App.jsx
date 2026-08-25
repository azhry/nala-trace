import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, getSessions, getTrace, NALA_LABS_ACCESS_TOKEN_STORAGE_KEY, resolveSession } from './api'
import { AuthHandoffError, readNalaLabsAuthCode, redirectToNalaLabs, redeemNalaLabsAuthCode, signOutFromTrace } from './authHandoff'
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

function hasStoredNalaLabsSession() {
  try {
    return Boolean(window.sessionStorage?.getItem(NALA_LABS_ACCESS_TOKEN_STORAGE_KEY))
  } catch {
    return false
  }
}

function shouldRedirectOnEntry() {
  return !hasStoredNalaLabsSession() && !readNalaLabsAuthCode()
}

function AuthBoundary({ apiState, handoffState, onRetry }) {
  const isLoading = apiState === 'loading'
  const isUnauthorized = apiState === 'unauthorized'
  const redirectedRef = useRef(false)
  const title = isLoading || isUnauthorized ? 'Sign in through Nala Labs' : 'Sessions could not be loaded.'
  const defaultDetail = isLoading
    ? 'Your Nala Labs application session is being checked before Trace data can be shown.'
      : isUnauthorized
        ? 'Your Nala Labs application session could not be verified. Sign in through Nala Labs, then try again.'
        : 'The protected Trace session request did not return data. Sign in through Nala Labs, then retry.'
  const detail = handoffState === 'waiting'
    ? 'Redirecting to Nala Labs for sign-in.'
    : handoffState === 'invalid'
      ? 'Nala Labs did not return a usable session. Start sign-in again, then retry.'
        : defaultDetail
  const actionLabel = isLoading ? 'Retry authentication' : 'Try again'

  useEffect(() => {
    if (!isUnauthorized || handoffState !== 'idle' || redirectedRef.current) return
    redirectedRef.current = true
    redirectToNalaLabs()
  }, [handoffState, isUnauthorized])

  function openLogin() {
    redirectToNalaLabs()
  }

  function retry() { onRetry() }

  return (
    <main className="auth-boundary" aria-labelledby="auth-boundary-title">
      <section className="auth-boundary-panel" role={isLoading ? 'status' : 'alert'} aria-live="polite">
        <p className="eyebrow">Nala Trace access</p>
        <h1 id="auth-boundary-title">{title}</h1>
        <p>{detail}</p>
        {isUnauthorized && <button type="button" className="state-action" onClick={openLogin}>Sign in through Nala Labs</button>}
        <button type="button" className="state-action" onClick={retry}>{actionLabel}</button>
      </section>
    </main>
  )
}

function Topbar({ route, session, apiState, onSignOut }) {
  const source = dataSourceCopy(apiState)
  return <header className="topbar"><div className="breadcrumb"><span>Nala Trace</span><span>/</span><strong>{route.view === 'detail' ? 'Session detail' : 'Sessions'}</strong></div><div className="topbar-right"><span className={`source-chip ${apiState}`}><span className="pulse-dot" />{source.label}</span>{route.view === 'detail' && <span className="topbar-session">{session?.id}</span>}<button type="button" className="sign-out-button" onClick={() => onSignOut()}>Sign out</button></div></header>
}

function SessionStats({ sessions }) {
  const tools = sessions.reduce((total, session) => total + session.toolCallCount, 0)
  const mcpCalls = sessions.reduce((total, session) => total + session.mcpCallCount, 0)
  const mcpServers = [...new Set(sessions.flatMap((session) => Array.isArray(session.mcpServers) ? session.mcpServers : []))]
  const attention = sessions.filter((session) => session.status === 'attention').length
  const latest = sessions.reduce((current, session) => {
    if (!current || (session.lastEventTime || 0) > (current.lastEventTime || 0)) return session
    return current
  }, null)
  return <div className="workspace-stats" aria-label="Session summary"><div><span>Sessions</span><strong>{String(sessions.length).padStart(2, '0')}</strong><small>available to this account</small></div><div><span>Tool calls</span><strong>{tools.toLocaleString()}</strong><small>from bounded summaries</small></div><div aria-label={`${mcpCalls} MCP calls across ${mcpServers.length} unique MCP servers`}><span>MCP calls</span><strong>{mcpCalls.toLocaleString()}</strong><small>{mcpServers.length ? `${mcpServers.length} unique servers` : 'No MCP servers recorded'}</small>{mcpServers.length > 0 && <span className="workspace-stat-server-list" title={mcpServers.join(', ')}>MCP: {mcpServers.join(' · ')}</span>}</div><div><span>Needs review</span><strong className={attention ? 'text-amber' : 'text-green'}>{String(attention).padStart(2, '0')}</strong><small>evaluation signal when available</small></div><div><span>Last captured</span><strong>{latest ? formatSessionDate(latest.lastEventAt) : '—'}</strong><small>most recent event</small></div></div>
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

function DetailPage({ session, onBack, apiState, traceState, traceError, onTraceRetry }) {
  const source = dataSourceCopy(apiState)
  const statusLabel = session.status === 'attention' ? 'Needs review' : session.status === 'passed' ? 'Passed' : 'Captured'
  return <section className="page-section detail-page" aria-labelledby="detail-title"><button type="button" className="back-button" onClick={onBack}>← <span>All sessions</span></button><div className="detail-heading"><div><p className="eyebrow">Session detail</p><h1 id="detail-title">{session.title || session.id}</h1><p>{session.id} · captured {formatSessionDate(session.firstEventAt)}–{formatSessionDate(session.lastEventAt)}</p></div><div className="detail-heading-meta"><span className="source-note">Source: {source.label.toLowerCase()}</span><span className={`detail-status ${session.status}`}>{session.outcome || statusLabel}</span></div></div><DataSourceNotice apiState={apiState} /><SessionMetadata session={session} /><div className="detail-layout"><TraceView session={session} traceState={traceState} traceError={traceError} onRetry={onTraceRetry} /><InsightCards insights={session.insights || { metrics: [] }} /></div></section>
}

export default function App() {
  const [route, setRoute] = useState(() => parseRoute())
  const [sessions, setSessions] = useState([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('recent')
  const [apiState, setApiState] = useState('loading')
  const [handoffState, setHandoffState] = useState('idle')
  const [remoteTrace, setRemoteTrace] = useState(null)
  const [traceState, setTraceState] = useState('idle')
  const [traceError, setTraceError] = useState(null)
  const [redirectOnEntry] = useState(() => shouldRedirectOnEntry())
  const redirectedOnEntryRef = useRef(false)

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const loadSessions = useCallback((isActive = () => true) => {
    setApiState('loading')
    redeemNalaLabsAuthCode().then((result) => {
      if (!isActive()) return null
      setHandoffState(result.attempted ? 'waiting' : 'idle')
      return resolveSession()
    }).then(() => {
      if (!isActive()) return null
      return getSessions()
    }).then((payload) => {
      if (!isActive() || !payload) return
      setHandoffState('idle')
      const normalized = normalizeSessionSummaries(payload)
      setSessions(normalized)
      setApiState('connected')
    }).catch((error) => {
      if (!isActive()) return
      setHandoffState(error instanceof AuthHandoffError ? 'invalid' : 'idle')
      setApiState(error instanceof ApiError && error.status === 401 ? 'unauthorized' : 'error')
    })
  }, [])

  useEffect(() => {
    if (redirectOnEntry) {
      if (redirectedOnEntryRef.current) return
      redirectedOnEntryRef.current = true
      redirectToNalaLabs()
      return
    }

    let active = true
    loadSessions(() => active)
    return () => { active = false }
  }, [loadSessions, redirectOnEntry])

  const selectedSession = useMemo(() => sessions.find((session) => session.id === route.sessionId), [route.sessionId, sessions])

  const loadTrace = useCallback((sessionId, isActive = () => true) => {
    if (!sessionId) return Promise.resolve(null)
    setRemoteTrace(null)
    setTraceError(null)
    setTraceState('loading')
    return getTrace(sessionId).then((payload) => {
      if (!isActive()) return payload
      setRemoteTrace(payload || {})
      setTraceState('ready')
      return payload
    }).catch((error) => {
      if (!isActive()) return null
      setTraceError(error)
      setTraceState(error instanceof ApiError && error.status === 404
        ? 'missing'
        : error instanceof ApiError && error.status === 401
          ? 'unauthorized'
          : 'error')
      return null
    })
  }, [])

  useEffect(() => {
    let mounted = true
    if (apiState !== 'connected' || route.view !== 'detail' || !route.sessionId) {
      setRemoteTrace(null)
      setTraceError(null)
      setTraceState('idle')
      return () => { mounted = false }
    }
    loadTrace(route.sessionId, () => mounted)
    return () => { mounted = false }
  }, [apiState, loadTrace, route.sessionId, route.view])

  const detailSession = remoteTrace
    ? { ...(selectedSession || { id: route.sessionId, title: route.sessionId, status: 'captured' }), ...remoteTrace }
    : selectedSession || (route.view === 'detail' && route.sessionId ? { id: route.sessionId, title: route.sessionId, status: 'captured' } : null)

  function selectSession(id) {
    navigateTo(`sessions/${encodeURIComponent(id)}`)
  }

  if (redirectOnEntry) return null
  if (apiState !== 'connected') return <AuthBoundary apiState={apiState} handoffState={handoffState} onRetry={loadSessions} />

  const showDetail = route.view === 'detail' && apiState === 'connected' && detailSession
  return <div className="app-shell"><main className="main-content"><Topbar route={route} session={selectedSession} apiState={apiState} onSignOut={signOutFromTrace} />{showDetail ? <DetailPage session={detailSession} apiState={apiState} traceState={traceState} traceError={traceError} onTraceRetry={() => loadTrace(route.sessionId)} onBack={() => navigateTo('sessions')} /> : <SessionsPage sessions={sessions} selectedId={selectedSession?.id} onSelect={selectSession} query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} sortBy={sortBy} onSortChange={setSortBy} apiState={apiState} onRetry={loadSessions} />}</main></div>
}
