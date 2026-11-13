import { useEffect, useRef } from 'react'
import { Button } from '@ui-sdk/react/button'
import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@ui-sdk/react/dialog'
import { redirectToNalaLabs } from './authHandoff'
import { formatSessionDate } from './sessionSummaries'
import EvaluationPage from './components/EvaluationPage'
import InsightCards from './components/InsightCards'
import SessionList from './components/SessionList'
import SessionMetadata from './components/SessionMetadata'
import TraceView, { TraceLoadingPanel } from './components/TraceView'
import ThemeToggle from './ThemeToggle'

function Icon({ name, size = 17 }) {
  const paths = {
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    close: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
    database: <><ellipse cx="12" cy="5.5" rx="7.5" ry="3" /><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" /><path d="M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" /></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    menu: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,
    trace: <><path d="M4 18h4l3-12 3 12h6" /><path d="M4 12h2m12 0h2" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function BrandMark() {
  return <span className="trace-brand-mark" aria-hidden="true"><Icon name="trace" size={20} /></span>
}

function sourceCopy(apiState) {
  if (apiState === 'connected') return { label: 'Go API data', status: 'Go API connected', detail: 'Using live session records from the protected Go API' }
  if (apiState === 'unauthorized') return { label: 'Sign-in required', status: 'Authentication required', detail: 'Resolve an authenticated application session to view records' }
  if (apiState === 'error') return { label: 'API unavailable', status: 'API unavailable', detail: 'The session service did not return a usable response' }
  return { label: 'Checking session', status: 'Checking application session', detail: 'Resolving authentication before requesting session records' }
}

function NavigationDialog() {
  return <Dialog>
    <DialogTrigger className="trace-mobile-menu" aria-label="Open Trace navigation"><Icon name="menu" size={19} /><span>Menu</span></DialogTrigger>
    <DialogBackdrop className="trace-mobile-backdrop" />
    <DialogContent className="trace-mobile-dialog">
      <div className="trace-mobile-dialog__head"><DialogTitle>Trace navigation</DialogTitle><DialogClose className="trace-icon-button" aria-label="Close navigation"><Icon name="close" /></DialogClose></div>
      <nav className="trace-mobile-links" aria-label="Trace navigation">
        <DialogClose className="trace-mobile-link trace-mobile-link--active" render={<a href="#/sessions" />}>Session records</DialogClose>
      </nav>
      <p>Captured session data is shown with its source and provenance.</p>
    </DialogContent>
  </Dialog>
}

function TraceRail({ route, apiState }) {
  const source = sourceCopy(apiState)
  return <aside className="trace-rail" aria-label="Primary navigation">
    <a className="trace-brand" href="#/sessions" aria-label="Nala Trace session records">
      <BrandMark />
      <span><strong>Nala Trace</strong><small>SESSION EVIDENCE</small></span>
    </a>
    <span className="trace-rail__label">WORKSPACE</span>
    <nav className="trace-rail__nav" aria-label="Trace navigation">
      <a href="#/sessions" className={route.view === 'sessions' ? 'is-active' : ''} aria-current={route.view === 'sessions' ? 'page' : undefined}>
        <Icon name="grid" /><span>Session records</span><small>01</small>
      </a>
    </nav>
    <div className="trace-rail__footer">
      <span className="trace-rail__label">DATA SOURCE</span>
      <strong className={'trace-connection trace-connection--' + apiState}><span />{source.status}</strong>
      <p>{apiState === 'connected' ? 'Protected API records' : source.detail}</p>
    </div>
  </aside>
}

function TraceTopbar({ route, session, apiState, onSignOut }) {
  const source = sourceCopy(apiState)
  const pageLabel = route.view === 'evaluation' ? 'Evaluation review' : route.view === 'detail' ? 'Session detail' : 'Session records'
  return <header className="trace-topbar">
    <NavigationDialog />
    <div className="trace-topbar__title"><span>NALA TRACE</span><span aria-hidden="true">/</span><strong>{pageLabel}</strong></div>
    <span className={'trace-source-chip trace-source-chip--' + apiState}><span />{source.label}</span>
    {(route.view === 'detail' || route.view === 'evaluation') && <span className="trace-topbar__session" title={session?.id}>{session?.id}</span>}
    <ThemeToggle />
    <Button className="trace-signout" onClick={() => onSignOut()}>Sign out</Button>
  </header>
}

export function TraceShell({ route, session, apiState, onSignOut, children }) {
  return <div className="trace-app-shell">
    <a className="nala-skip-link" href="#trace-main">Skip to Trace content</a>
    <TraceRail route={route} apiState={apiState} />
    <div className="trace-workspace">
      <TraceTopbar route={route} session={session} apiState={apiState} onSignOut={onSignOut} />
      <main id="trace-main" className="trace-main">{children}</main>
    </div>
  </div>
}

export function AuthBoundary({ handoffState, onRetry }) {
  const redirectedRef = useRef(false)
  const defaultDetail = 'Your Nala Labs application session could not be verified. Sign in through Nala Labs, then try again.'
  const detail = handoffState === 'waiting'
    ? 'Redirecting to Nala Labs for sign-in.'
    : handoffState === 'invalid'
      ? 'Nala Labs did not return a usable session. Start sign-in again, then retry.'
      : defaultDetail

  useEffect(() => {
    if (handoffState !== 'idle' || redirectedRef.current) return
    redirectedRef.current = true
    redirectToNalaLabs()
  }, [handoffState])

  return <main className="trace-auth-boundary" aria-labelledby="auth-boundary-title">
    <div className="trace-auth-top"><a className="trace-brand" href="#/sessions"><BrandMark /><span><strong>Nala Trace</strong><small>SESSION EVIDENCE</small></span></a><ThemeToggle /></div>
    <section className="trace-auth-panel" role="alert" aria-live="polite">
      <span className="trace-auth-panel__marker"><span /></span>
      <p className="eyebrow">NALA TRACE / ACCESS</p>
      <h1 id="auth-boundary-title">Sign in through Nala Labs</h1>
      <p>{detail}</p>
      <div className="trace-auth-actions">
        <Button className="button--primary" onClick={() => redirectToNalaLabs()}>Continue to Nala Labs<Icon name="arrow" /></Button>
        <Button className="button--quiet" onClick={() => onRetry()}>Try again</Button>
      </div>
      <small>Nala Labs owns the application session. Trace verifies that session before reading records.</small>
    </section>
  </main>
}

function DataSourceNotice({ apiState }) {
  const source = sourceCopy(apiState)
  if (apiState === 'connected') return null
  return <div className={'trace-source-notice trace-source-notice--' + apiState} role="status">
    <span className="trace-source-notice__mark" />
    <div><strong>{source.status}</strong><p>{source.detail}. Only captured records from this source are shown.</p></div>
  </div>
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
  return <section className="trace-summary-strip" aria-label="Session summary">
    <div><span>Sessions</span><strong>{sessions.length.toLocaleString()}</strong><small>available to this account</small></div>
    <div><span>Tool calls</span><strong>{tools.toLocaleString()}</strong><small>from bounded summaries</small></div>
    <div><span>MCP calls</span><strong>{mcpCalls.toLocaleString()}</strong><small>{mcpServers.length ? mcpServers.length + ' unique servers' : 'No servers recorded'}</small></div>
    <div><span>Needs review</span><strong>{attention.toLocaleString()}</strong><small>{latest ? 'Latest ' + formatSessionDate(latest.lastEventAt) : 'No latest event'}</small></div>
  </section>
}

export function SessionStatePanel({ state, onRetry }) {
  const unauthorized = state === 'unauthorized'
  return <section className="trace-state-panel" role="alert" aria-labelledby="session-state-title">
    <span className="trace-state-code">{unauthorized ? 'AUTH' : 'READ'}</span>
    <div><p className="eyebrow">{unauthorized ? 'SESSION REQUIRED' : 'REQUEST FAILED'}</p>
      <h2 id="session-state-title">{unauthorized ? 'Sign in to view sessions.' : 'Sessions could not be loaded.'}</h2>
      <p>{unauthorized ? 'Your application session could not be resolved. Sign in through Nala Labs, then try again.' : 'The Trace API returned an error while reading session summaries. Your existing session access has not changed.'}</p>
      <Button className="button--primary" onClick={onRetry}>{unauthorized ? 'Retry session check' : 'Retry request'}<Icon name="arrow" /></Button>
    </div>
  </section>
}

export function SessionsPage({ sessions, selectedId, onSelect, query, onQueryChange, filter, onFilterChange, sortBy, onSortChange, apiState, onRetry }) {
  const source = sourceCopy(apiState)
  return <section className="trace-page trace-sessions-page" aria-labelledby="sessions-title">
    <div className="trace-page-heading">
      <div><p className="eyebrow">SESSION LEDGER / 01</p><h1 id="sessions-title">All captured sessions</h1><p>Inspect recorded conversations, tool calls, trace events, and review evidence.</p></div>
      <div className="trace-page-heading__source"><span>RECORD SOURCE</span><strong>{source.label}</strong></div>
    </div>
    <DataSourceNotice apiState={apiState} />
    {apiState === 'loading' ? <TraceLoadingPanel title="Loading sessions…" detail="Resolving your application session before reading Trace records." />
      : apiState === 'connected' ? <>
        <SessionStats sessions={sessions} />
        <SessionList sessions={sessions} selectedId={selectedId} onSelect={onSelect} query={query} onQueryChange={onQueryChange} filter={filter} onFilterChange={onFilterChange} sortBy={sortBy} onSortChange={onSortChange} onRetry={onRetry} />
      </> : <SessionStatePanel state={apiState} onRetry={onRetry} />}
  </section>
}

export function DetailPage({ session, apiState, traceState, traceError, onTraceRetry, onLoadMore, isLoadingMore, loadMoreError, onBack }) {
  const isLoading = traceState === 'loading'
  const statusLabel = session.status === 'attention' ? 'Needs review' : session.status === 'passed' ? 'Passed' : 'Captured'
  const evaluationHref = '#/sessions/' + encodeURIComponent(session.id) + '/evaluation'
  return <section className="trace-page trace-detail-page" aria-labelledby="detail-title">
    <Button className="trace-back-link" onClick={onBack}>← <span>All sessions</span></Button>
    <div className="trace-detail-heading">
      <div><p className="eyebrow">SESSION DETAIL / {session.id}</p><h1 id="detail-title">{session.title || session.id}</h1>
        <p>{session.id} <span>·</span> captured {formatSessionDate(session.firstEventAt)}–{formatSessionDate(session.lastEventAt)}</p>
      </div>
      <div className="trace-detail-heading__aside"><span className={'trace-record-status trace-record-status--' + session.status}><span />{session.outcome || (isLoading ? 'Loading' : statusLabel)}</span><a className="trace-review-link" href={evaluationHref}>View annotation and evaluation<Icon name="arrow" size={15} /></a></div>
    </div>
    <DataSourceNotice apiState={apiState} />
    {isLoading ? <TraceLoadingPanel /> : <>
      <SessionMetadata session={session} />
      <div className="trace-detail-layout">
        <TraceView session={session} traceState={traceState} traceError={traceError} onRetry={onTraceRetry} onLoadMore={onLoadMore} isLoadingMore={isLoadingMore} loadMoreError={loadMoreError} />
        <InsightCards analysis={session.analysis ?? null} trace={session} insights={session.insights} compact sessionId={session.id} />
      </div>
    </>}
  </section>
}

export function EvaluationRoute({ session, analysis, analysisState, analysisError, onAnalysisRetry, onBack }) {
  return <EvaluationPage session={session} analysis={analysis} analysisState={analysisState} analysisError={analysisError} onAnalysisRetry={onAnalysisRetry} onBack={onBack} />
}
