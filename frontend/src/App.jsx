import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, getSessionAnalysis, getSessions, getTrace, resolveSession, SESSION_TRACE_PAGE_SIZE } from './api'
import { AuthHandoffError, redirectToNalaLabs, redeemNalaLabsAuthCode, signOutFromTrace } from './authHandoff'
import InsightCards from './components/InsightCards'
import EvaluationPage from './components/EvaluationPage'
import SessionList from './components/SessionList'
import SessionMetadata from './components/SessionMetadata'
import ScrollToTopButton from './components/ScrollToTopButton'
import TraceView, { TraceLoadingPanel } from './components/TraceView'
import ThemeToggle from './ThemeToggle'
import { formatSessionDate, normalizeSessionSummaries } from './sessionSummaries'

function parseRoute(hash = window.location.hash) {
  const path = hash.replace(/^#\/?/, '') || 'sessions'
  const evaluationMatch = path.match(/^sessions\/([^/]+)\/evaluation$/)
  if (evaluationMatch) return { view: 'evaluation', sessionId: decodeURIComponent(evaluationMatch[1]) }
  const match = path.match(/^sessions\/([^/]+)$/)
  return match ? { view: 'detail', sessionId: decodeURIComponent(match[1]) } : { view: 'sessions', sessionId: null }
}

function navigateTo(path) {
  window.location.hash = `/${path}`
}

export const TRACE_LOADING_MIN_DURATION_MS = 180

function tracePageRecordKey(collection, record = {}) {
  const eventId = record.event_id ?? record.eventId
  if (collection === 'timeline') return record.id == null ? null : `timeline:${record.id}`
  if (collection === 'conversation') return eventId == null ? null : `conversation:${eventId}`
  if (collection === 'tool_calls') {
    const id = record.__traceToolCallIndex ?? record.tool_use_id ?? record.toolUseId ?? record.tool_call_index ?? record.toolCallIndex ?? eventId
    return id == null ? null : `tool:${id}`
  }
  if (collection === 'skill_invocations') {
    return eventId == null ? null : `skill:${eventId}:${record.name ?? record.skill_name ?? record.skill ?? ''}`
  }
  if (collection === 'files') {
    return eventId == null ? null : `file:${eventId}:${record.path ?? ''}:${record.operation ?? record.action ?? ''}`
  }
  return null
}

function appendTracePageRecords(collection, current = [], next = []) {
  const records = Array.isArray(current) ? [...current] : []
  const seen = new Set(records.map((record) => tracePageRecordKey(collection, record)).filter((key) => key !== null))

  for (const record of Array.isArray(next) ? next : []) {
    const key = tracePageRecordKey(collection, record)
    if (key !== null && seen.has(key)) continue
    records.push(record)
    if (key !== null) seen.add(key)
  }

  return records
}

function prepareTracePage(page = {}) {
  const timeline = Array.isArray(page.timeline) ? page.timeline.map((event) => {
    const toolCallIndex = event.__traceToolCallIndex ?? event.tool_call_index ?? event.toolCallIndex
    return Number.isInteger(toolCallIndex) ? { ...event, __traceToolCallIndex: toolCallIndex } : event
  }) : []
  const pageToolIndexes = [...new Set(timeline
    .filter((event) => event.hook_event_name === 'PreToolUse' || event.hookEventName === 'PreToolUse')
    .map((event) => event.__traceToolCallIndex)
    .filter(Number.isInteger))].sort((left, right) => left - right)
  const tool_calls = Array.isArray(page.tool_calls) ? page.tool_calls.map((call, index) => {
    const toolCallIndex = call.__traceToolCallIndex ?? call.tool_call_index ?? call.toolCallIndex ?? pageToolIndexes[index]
    return Number.isInteger(toolCallIndex) ? { ...call, __traceToolCallIndex: toolCallIndex } : call
  }) : []
  return { ...page, timeline, tool_calls }
}

function alignTraceToolCallIndexes(trace) {
  const compactIndexes = new Map()
  trace.tool_calls.forEach((call, index) => {
    if (Number.isInteger(call.__traceToolCallIndex)) compactIndexes.set(call.__traceToolCallIndex, index)
  })
  return {
    ...trace,
    timeline: trace.timeline.map((event) => {
      const toolCallIndex = event.__traceToolCallIndex ?? event.tool_call_index ?? event.toolCallIndex
      if (!Number.isInteger(toolCallIndex)) return event
      return { ...event, __traceToolCallIndex: toolCallIndex, tool_call_index: compactIndexes.get(toolCallIndex) ?? null }
    }),
  }
}

function mergeTracePage(current, next) {
  const previous = current ? prepareTracePage(current) : {}
  const upcoming = prepareTracePage(next)
  const merged = { ...previous, ...upcoming }
  for (const collection of ['timeline', 'conversation', 'tool_calls', 'skill_invocations', 'files']) {
    merged[collection] = appendTracePageRecords(collection, previous[collection], upcoming[collection])
  }
  for (const field of ['summary', 'analysis', 'runtime_metadata']) {
    if (previous[field] != null) merged[field] = previous[field]
  }
  return alignTraceToolCallIndexes(merged)
}

function hasContiguousNextTracePage(current, next, nextOffset, limit) {
  const currentTimeline = Array.isArray(current?.timeline) ? current.timeline : []
  const nextTimeline = Array.isArray(next?.timeline) ? next.timeline : []
  const pagination = next?.pagination
  const total = Number(pagination?.total)

  if (currentTimeline.length !== nextOffset || !Number.isInteger(total) || total <= nextOffset) return false
  if (currentTimeline.some((event) => typeof event?.id !== 'string' || !event.id)) return false
  if (Number(pagination?.offset) !== nextOffset || Number(pagination?.limit) !== limit) return false
  const expectedNewRows = Math.min(limit, total - nextOffset)
  if (pagination.has_more !== (nextOffset + expectedNewRows < total)) return false

  const seenIds = new Set(currentTimeline.map((event) => event.id))
  const newIds = new Set()
  for (const event of nextTimeline) {
    if (typeof event?.id !== 'string' || !event.id) return false
    if (!seenIds.has(event.id)) newIds.add(event.id)
  }
  return newIds.size === expectedNewRows
}

function dataSourceCopy(apiState) {
  if (apiState === 'connected') return { label: 'Go API data', status: 'Go API connected', detail: 'Using live session records from the protected Go API' }
  if (apiState === 'unauthorized') return { label: 'Sign-in required', status: 'Authentication required', detail: 'Resolve an authenticated application session to view records' }
  if (apiState === 'error') return { label: 'API unavailable', status: 'API unavailable', detail: 'The session service did not return a usable response' }
  return { label: 'Checking session', status: 'Checking application session', detail: 'Resolving authentication before requesting session records' }
}

function AuthBoundary({ handoffState, onRetry }) {
  const redirectedRef = useRef(false)
  const defaultDetail = 'Your Nala Labs application session could not be verified. Sign in through Nala Labs, then try again.'
  const detail = handoffState === 'waiting'
    ? 'Redirecting to Nala Labs for sign-in.'
    : handoffState === 'invalid'
      ? 'Nala Labs did not return a usable session. Start sign-in again, then retry.'
        : defaultDetail
  const actionLabel = 'Try again'

  useEffect(() => {
    if (handoffState !== 'idle' || redirectedRef.current) return
    redirectedRef.current = true
    redirectToNalaLabs()
  }, [handoffState])

  function openLogin() {
    redirectToNalaLabs()
  }

  function retry() { onRetry() }

  return (
    <main className="auth-boundary" aria-labelledby="auth-boundary-title">
      <div className="auth-appearance"><ThemeToggle /></div>
      <section className="auth-boundary-panel" role="alert" aria-live="polite">
        <p className="eyebrow">Nala Trace access</p>
        <h1 id="auth-boundary-title">Sign in through Nala Labs</h1>
        <p>{detail}</p>
        <button type="button" className="state-action" onClick={openLogin}>Sign in through Nala Labs</button>
        <button type="button" className="state-action" onClick={retry}>{actionLabel}</button>
      </section>
    </main>
  )
}

function Topbar({ route, session, apiState, onSignOut }) {
  const source = dataSourceCopy(apiState)
  const pageLabel = route.view === 'evaluation' ? 'Session evaluation' : route.view === 'detail' ? 'Session detail' : 'Sessions'
  return <header className="topbar"><div className="breadcrumb"><span className="trace-product-name">Nala Trace</span><span aria-hidden="true">/</span><strong>{pageLabel}</strong></div><div className="topbar-right"><span className={`source-chip ${apiState}`}><span className="pulse-dot" />{source.label}</span>{(route.view === 'detail' || route.view === 'evaluation') && <span className="topbar-session">{session?.id}</span>}<ThemeToggle /><button type="button" className="sign-out-button" onClick={() => onSignOut()}>Sign out</button></div></header>
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
  if (state === 'unauthorized') return <div className="panel session-state-panel" role="alert"><strong>Sign in to view sessions.</strong><span>Your application session could not be resolved. Sign in, then try again.</span><button type="button" className="state-action" onClick={onRetry}>Try again</button></div>
  return <div className="panel session-state-panel" role="alert"><strong>Sessions could not be loaded.</strong><span>The API returned an error while reading session summaries.</span><button type="button" className="state-action" onClick={onRetry}>Retry request</button></div>
}

function SessionsPage({ sessions, selectedId, onSelect, query, onQueryChange, filter, onFilterChange, sortBy, onSortChange, apiState, onRetry }) {
  const source = dataSourceCopy(apiState)
  return <section className="page-section" aria-labelledby="sessions-title"><div className="page-heading"><div><p className="eyebrow">Session list</p><h1 id="sessions-title">All captured sessions</h1><p>Choose a session to open its detailed conversation, tool calls, trace events, and review signal.</p></div><span className="source-note">Source: {source.label.toLowerCase()}</span></div><DataSourceNotice apiState={apiState} />{apiState === 'loading' ? <TraceLoadingPanel title="Loading sessions…" detail="Resolving your application session before reading Trace records." /> : apiState === 'connected' ? <><SessionStats sessions={sessions} /><SessionList sessions={sessions} selectedId={selectedId} onSelect={onSelect} query={query} onQueryChange={onQueryChange} filter={filter} onFilterChange={onFilterChange} sortBy={sortBy} onSortChange={onSortChange} /></> : <SessionStatePanel state={apiState} onRetry={onRetry} />}</section>
}

function DetailPage({ session, onBack, apiState, traceState, traceError, onTraceRetry, onLoadMore, isLoadingMore, loadMoreError }) {
  const source = dataSourceCopy(apiState)
  const isLoading = traceState === 'loading'
  const statusLabel = session.status === 'attention' ? 'Needs review' : session.status === 'passed' ? 'Passed' : 'Captured'
  const evaluationHref = `#/sessions/${encodeURIComponent(session.id)}/evaluation`
  return <section className="page-section detail-page" aria-labelledby="detail-title"><button type="button" className="back-button" onClick={onBack}>← <span>All sessions</span></button><div className="detail-heading"><div><p className="eyebrow">Session detail</p><h1 id="detail-title">{session.title || session.id}</h1><a className="detail-analysis-link" href={evaluationHref}>View annotation and evaluation</a><p>{session.id} · captured {formatSessionDate(session.firstEventAt)}–{formatSessionDate(session.lastEventAt)}</p></div><div className="detail-heading-meta"><span className="source-note">Source: {source.label.toLowerCase()}</span><span className={`detail-status ${session.status}`}>{session.outcome || (isLoading ? 'Loading' : statusLabel)}</span></div></div><DataSourceNotice apiState={apiState} />{isLoading ? <TraceLoadingPanel /> : <><SessionMetadata session={session} /><div className="detail-layout"><TraceView session={session} traceState={traceState} traceError={traceError} onRetry={onTraceRetry} onLoadMore={onLoadMore} isLoadingMore={isLoadingMore} loadMoreError={loadMoreError} /><InsightCards analysis={session.analysis ?? null} trace={session} insights={session.insights} compact sessionId={session.id} /></div></>}</section>
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
  const [traceSessionId, setTraceSessionId] = useState(null)
  const [traceRequestSessionId, setTraceRequestSessionId] = useState(null)
  const [traceState, setTraceState] = useState('idle')
  const [traceError, setTraceError] = useState(null)
  const [tracePageState, setTracePageState] = useState('idle')
  const [tracePageError, setTracePageError] = useState(null)
  const traceRequestVersionRef = useRef(0)
  const activeTracePageRequestRef = useRef(null)
  const [analysisPayload, setAnalysisPayload] = useState(null)
  const [analysisSessionId, setAnalysisSessionId] = useState(null)
  const [analysisState, setAnalysisState] = useState('idle')
  const [analysisError, setAnalysisError] = useState(null)
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
    let active = true
    loadSessions(() => active)
    return () => { active = false }
  }, [loadSessions])

  const selectedSession = useMemo(() => sessions.find((session) => session.id === route.sessionId), [route.sessionId, sessions])

  const loadTrace = useCallback((sessionId, isActive = () => true) => {
    if (!sessionId) return Promise.resolve(null)
    const requestVersion = traceRequestVersionRef.current + 1
    traceRequestVersionRef.current = requestVersion
    activeTracePageRequestRef.current = null
    const loadingStartedAt = Date.now()
    const settleAfterVisibleLoading = (settle) => {
      const remaining = Math.max(0, TRACE_LOADING_MIN_DURATION_MS - (Date.now() - loadingStartedAt))
      return new Promise((resolve) => window.setTimeout(resolve, remaining)).then(settle)
    }
    setTraceRequestSessionId(sessionId)
    setRemoteTrace(null)
    setTraceSessionId(null)
    setTraceError(null)
    setTraceState('loading')
    setTracePageState('idle')
    setTracePageError(null)
    return getTrace(sessionId, { offset: 0, limit: SESSION_TRACE_PAGE_SIZE }).then((payload) => settleAfterVisibleLoading(() => {
      if (!isActive() || requestVersion !== traceRequestVersionRef.current) return payload
      setRemoteTrace(mergeTracePage(null, payload || {}))
      setTraceSessionId(sessionId)
      setTraceState('ready')
      return payload
    })).catch((error) => settleAfterVisibleLoading(() => {
      if (!isActive() || requestVersion !== traceRequestVersionRef.current) return null
      setTraceError(error)
      setTraceState(error instanceof ApiError && error.status === 404
        ? 'missing'
        : error instanceof ApiError && error.status === 401
          ? 'unauthorized'
          : 'error')
      return null
    }))
  }, [])

  const loadMoreTrace = useCallback((sessionId) => {
    const pagination = remoteTrace?.pagination
    if (!sessionId || traceSessionId !== sessionId || !pagination?.has_more || activeTracePageRequestRef.current) return Promise.resolve(null)
    const offset = Number(pagination.offset)
    const limit = Number(pagination.limit)
    if (!Number.isInteger(offset) || !Number.isInteger(limit) || limit < 1) return Promise.resolve(null)

    const nextOffset = offset + limit
    const loadedTimelineCount = Array.isArray(remoteTrace.timeline) ? remoteTrace.timeline.length : 0
    const requestVersion = traceRequestVersionRef.current
    const requestToken = Symbol('trace-page-request')
    activeTracePageRequestRef.current = requestToken
    setTracePageState('loading')
    setTracePageError(null)

    if (loadedTimelineCount !== nextOffset) {
      setTracePageError(new Error('The session trace pages are not contiguous.'))
      setTracePageState('error')
      activeTracePageRequestRef.current = null
      return Promise.resolve(null)
    }

    return getTrace(sessionId, { offset: nextOffset, limit }).then((payload) => {
      if (requestVersion !== traceRequestVersionRef.current) return null
      if (!hasContiguousNextTracePage(remoteTrace, payload, nextOffset, limit)) {
        throw new Error('The session trace returned an invalid page.')
      }
      setRemoteTrace((current) => {
        if (!current || current.session_id !== sessionId || requestVersion !== traceRequestVersionRef.current) return current
        return mergeTracePage(current, payload)
      })
      setTracePageState('idle')
      return payload
    }).catch((error) => {
      if (requestVersion === traceRequestVersionRef.current) {
        setTracePageError(error)
        setTracePageState('error')
      }
      return null
    }).finally(() => {
      if (activeTracePageRequestRef.current === requestToken) activeTracePageRequestRef.current = null
    })
  }, [remoteTrace, traceSessionId])

  const loadAnalysis = useCallback((sessionId, isActive = () => true) => {
    if (!sessionId) return Promise.resolve(null)
    setAnalysisPayload(null)
    setAnalysisSessionId(null)
    setAnalysisError(null)
    setAnalysisState('loading')
    return getSessionAnalysis(sessionId).then((payload) => {
      if (!isActive()) return payload
      setAnalysisPayload(payload?.analysis ?? null)
      setAnalysisSessionId(sessionId)
      setAnalysisState('ready')
      return payload
    }).catch((error) => {
      if (!isActive()) return null
      setAnalysisError(error)
      setAnalysisSessionId(sessionId)
      setAnalysisState(error instanceof ApiError && error.status === 404 ? 'missing' : 'error')
      return null
    })
  }, [])

  useEffect(() => {
    let mounted = true
    if (apiState !== 'connected' || route.view !== 'detail' || !route.sessionId) {
      traceRequestVersionRef.current += 1
      activeTracePageRequestRef.current = null
      setRemoteTrace(null)
      setTraceSessionId(null)
      setTraceRequestSessionId(null)
      setTraceError(null)
      setTraceState('idle')
      setTracePageState('idle')
      setTracePageError(null)
      return () => { mounted = false }
    }
    loadTrace(route.sessionId, () => mounted)
    return () => { mounted = false }
  }, [apiState, loadTrace, route.sessionId, route.view])

  useEffect(() => {
    let mounted = true
    if (apiState !== 'connected' || route.view !== 'evaluation' || !route.sessionId) {
      setAnalysisPayload(null)
      setAnalysisSessionId(null)
      setAnalysisError(null)
      setAnalysisState('idle')
      return () => { mounted = false }
    }
    loadAnalysis(route.sessionId, () => mounted)
    return () => { mounted = false }
  }, [apiState, loadAnalysis, route.sessionId, route.view])

  const hasCurrentTrace = Boolean(remoteTrace && traceSessionId === route.sessionId)
  const detailTraceState = traceRequestSessionId !== route.sessionId ? 'loading' : traceState
  const detailSession = hasCurrentTrace
    ? { ...(selectedSession || { id: route.sessionId, title: route.sessionId, status: 'captured' }), ...remoteTrace }
    : selectedSession || (['detail', 'evaluation'].includes(route.view) && route.sessionId ? { id: route.sessionId, title: route.sessionId, status: 'captured' } : null)

  function selectSession(id) {
    navigateTo(`sessions/${encodeURIComponent(id)}`)
  }

  if (apiState === 'unauthorized') return <AuthBoundary handoffState={handoffState} onRetry={loadSessions} />
  if (apiState === 'error') return <div className="app-shell"><main className="main-content"><Topbar route={route} apiState={apiState} onSignOut={signOutFromTrace} /><section className="page-section" aria-label="Session loading error"><SessionStatePanel state="error" onRetry={loadSessions} /></section></main></div>

  const showDetail = route.view === 'detail' && detailSession
  const showEvaluation = route.view === 'evaluation' && apiState === 'connected' && detailSession
  return <div className="app-shell"><main className="main-content"><Topbar route={route} session={detailSession || selectedSession} apiState={apiState} onSignOut={signOutFromTrace} />{showEvaluation ? <EvaluationPage session={detailSession} analysis={analysisSessionId === route.sessionId ? analysisPayload : null} analysisState={analysisSessionId === route.sessionId ? analysisState : 'loading'} analysisError={analysisError} onAnalysisRetry={() => loadAnalysis(route.sessionId)} onBack={() => navigateTo(`sessions/${encodeURIComponent(route.sessionId)}`)} /> : showDetail ? <><DetailPage session={detailSession} apiState={apiState} traceState={apiState === 'loading' ? 'loading' : detailTraceState} traceError={traceError} onTraceRetry={() => loadTrace(route.sessionId)} onLoadMore={() => loadMoreTrace(route.sessionId)} isLoadingMore={tracePageState === 'loading'} loadMoreError={Boolean(tracePageError)} onBack={() => navigateTo('sessions')} /><ScrollToTopButton /></> : <SessionsPage sessions={sessions} selectedId={selectedSession?.id} onSelect={selectSession} query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} sortBy={sortBy} onSortChange={setSortBy} apiState={apiState} onRetry={loadSessions} />}</main></div>
}
