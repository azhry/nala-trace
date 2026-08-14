import { useEffect, useMemo, useState } from 'react'
import { getHealth, getSessions } from './api'
import InsightCards from './components/InsightCards'
import SessionList from './components/SessionList'
import TraceView from './components/TraceView'

const navItems = [
  { id: 'review', label: 'Review traces', hint: 'Find runs and inspect decisions', icon: '⌁' },
  { id: 'evaluations', label: 'Measure quality', hint: 'See evals and judge alignment', icon: '◒' },
  { id: 'reference', label: 'Reference set', hint: 'Protect trusted examples', icon: '✦' },
]

const pageCopy = {
  review: {
    eyebrow: 'Trace review / workspace',
    title: 'Understand the run, not just the result.',
    description: 'Start with a captured session. Follow the conversation, open the tool rows, and see the evidence behind the final outcome.',
  },
  evaluations: {
    eyebrow: 'Measure quality / workspace',
    title: 'Know when an agent is getting better.',
    description: 'Pair deterministic checks with judge alignment so a passing score still has a human-readable reason behind it.',
  },
  reference: {
    eyebrow: 'Reference set / workspace',
    title: 'Keep the examples that set the bar.',
    description: 'A small, trusted set gives every new trace something concrete to learn from and compare against.',
  },
}

const demoSessions = [
  {
    id: 'sess_8f24',
    title: 'Build the React shell',
    status: 'passed',
    capturedAt: '2 min ago',
    startedAt: '09:14:02',
    duration: '08m 12s',
    events: 38,
    toolCalls: 12,
    skills: 3,
    files: 8,
    latestTool: 'apply_patch',
    latestTime: '09:22:14',
    outcome: 'Passed',
    outcomeNote: '4 of 4 evals passed',
    insights: { evalPasses: 4, evalTotal: 4, judgeAlignment: 94, reviewSignal: 'Clear' },
    eventsList: [
      { id: 'e1', type: 'assistant', role: 'assistant', time: '09:14:08', body: 'I’ll map the existing frontend first, then shape the review flow around the trace data instead of starting from a blank dashboard.' },
      { id: 'e2', type: 'tool', index: '01', tool: 'rg', intent: 'Find the current app entrypoint and test seams', duration: '0.4s', status: 'success', skills: ['zoom-out'], files: ['frontend/src/App.jsx'], input: 'rg --files frontend/src', responseLabel: '12 files', response: 'frontend/src/App.jsx\nfrontend/src/main.jsx\nfrontend/src/__tests__/App.test.jsx' },
      { id: 'e3', type: 'assistant', role: 'assistant', time: '09:15:02', body: 'The current surface is a landing shell. I’m keeping the useful navigation, but making the session list the first decision point and the trace the main reading experience.' },
      { id: 'e4', type: 'tool', index: '02', tool: 'Get-Content', intent: 'Read the existing component and styling contract', duration: '0.2s', status: 'success', skills: ['frontend-design'], files: ['frontend/src/styles.css'], input: 'Get-Content frontend/src/styles.css', responseLabel: 'read', response: 'Current UI is a landing shell with compact type and no conversation/tool detail pane.' },
      { id: 'e5', type: 'tool', index: '03', tool: 'apply_patch', intent: 'Build the trace-review component model', duration: '1.8s', status: 'success', skills: ['frontend-design', 'tdd'], files: ['components/TraceView.jsx', 'components/ToolCallCard.jsx'], input: 'Add SessionList, TraceView, ToolCallCard, and InsightCards', responseLabel: 'applied', response: 'Applied component structure and interaction states.' },
      { id: 'e6', type: 'assistant', role: 'assistant', time: '09:22:14', body: 'The trace now reads as a sequence: find a run, follow what happened, and judge the evidence. The same structure carries across desktop and mobile.' },
    ],
  },
  {
    id: 'sess_4c19',
    title: 'Review auth boundary',
    status: 'passed',
    capturedAt: '18 min ago',
    startedAt: '08:51:11',
    duration: '05m 44s',
    events: 24,
    toolCalls: 8,
    skills: 2,
    files: 5,
    latestTool: 'linear_get_issue',
    latestTime: '08:56:55',
    outcome: 'Passed',
    outcomeNote: '3 of 3 evals passed',
    insights: { evalPasses: 3, evalTotal: 3, judgeAlignment: 91, reviewSignal: 'Clear' },
    eventsList: [
      { id: 'a1', type: 'assistant', role: 'assistant', time: '08:51:15', body: 'I’m checking the issue contract and the existing identity boundary before touching the service configuration.' },
      { id: 'a2', type: 'tool', index: '01', tool: 'linear_get_issue', intent: 'Read the implementation contract and acceptance criteria', duration: '0.7s', status: 'success', skills: ['linear-issue-management'], files: ['.agents/workflows/delivery.md'], input: '{ "issue": "AZH-452" }', responseLabel: 'loaded', response: 'Issue loaded: shared Nala Labs IAM, Vault-backed runtime configuration, health contract.' },
      { id: 'a3', type: 'assistant', role: 'assistant', time: '08:56:55', body: 'The browser should receive the Nala Labs token, while the API keeps the service-to-service boundary explicit. I’ll verify that the same token is accepted by nala-trace.' },
    ],
  },
  {
    id: 'sess_1b07',
    title: 'Trace proxy failure',
    status: 'attention',
    capturedAt: '1 hr ago',
    startedAt: '08:04:33',
    duration: '03m 19s',
    events: 17,
    toolCalls: 6,
    skills: 1,
    files: 3,
    latestTool: 'shell_command',
    latestTime: '08:07:52',
    outcome: 'Needs review',
    outcomeNote: '1 eval needs attention',
    insights: { evalPasses: 3, evalTotal: 4, judgeAlignment: 72, reviewSignal: 'Investigate' },
    eventsList: [
      { id: 'p1', type: 'assistant', role: 'assistant', time: '08:04:37', body: 'I’m reproducing the local health response and checking whether the service is talking to the configured dependencies or an old process.' },
      { id: 'p2', type: 'tool', index: '01', tool: 'shell_command', intent: 'Reproduce the local backend response', duration: '2.1s', status: 'attention', skills: ['diagnose'], files: ['frontend/vite.config.js'], input: 'Invoke-WebRequest http://localhost:3003/healthz', responseLabel: 'degraded', response: 'casdoor: not_configured\nvault: not_configured\nProcess has not restarted with current runtime configuration.' },
      { id: 'p3', type: 'assistant', role: 'assistant', time: '08:07:52', body: 'The result is not a live dependency check yet. This run needs a restart and a second capture before it can be considered healthy.' },
    ],
  },
]

const referenceRows = [
  { id: 'gold_014', title: 'Correctly routes API errors', category: 'routing', score: '100%', reviewed: 'Today' },
  { id: 'gold_011', title: 'Reads context before editing', category: 'workflow', score: '100%', reviewed: 'Yesterday' },
  { id: 'gold_008', title: 'Keeps secrets out of the client', category: 'security', score: '98%', reviewed: 'Aug 12' },
]

function viewFromHash(hash = window.location.hash) {
  const candidate = hash.replace('#/', '').replace('#', '')
  return navItems.some((item) => item.id === candidate) ? candidate : 'review'
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
}

function Sidebar({ activeView, onNavigate, apiState }) {
  return (
    <aside className="sidebar">
      <div className="brand-lockup"><BrandMark /><span>NALA<span className="brand-muted"> / TRACE</span></span></div>
      <div className="workspace-switcher"><span className="workspace-avatar">NL</span><span><strong>Nala Labs</strong><small>Trace workspace</small></span><span className="switcher-chevron">⌄</span></div>

      <div className="sidebar-section-label">Workspace</div>
      <nav className="sidebar-nav" aria-label="Workspace navigation">
        {navItems.map((item) => (
          <button key={item.id} type="button" className={`nav-item ${activeView === item.id ? 'is-active' : ''}`} onClick={() => onNavigate(item.id)} aria-current={activeView === item.id ? 'page' : undefined}>
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
            <span><strong>{item.label}</strong><small>{item.hint}</small></span>
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="capture-status"><span className={`status-dot ${apiState === 'connected' ? 'connected' : ''}`} /><span><strong>{apiState === 'connected' ? 'Go API connected' : 'Demo data active'}</strong><small>{apiState === 'connected' ? 'Live sessions can load here' : 'Showing representative traces'}</small></span></div>
        <div className="sidebar-footer"><span>nala-trace</span><span>v0.4.0</span></div>
      </div>
    </aside>
  )
}

function Topbar({ activeView }) {
  const label = pageCopy[activeView].eyebrow.split(' / ')[0]
  return <header className="topbar"><div className="breadcrumb"><span>Nala Labs</span><span>/</span><strong>{label}</strong></div><div className="topbar-right"><span className="capture-chip"><span className="pulse-dot" />Capturing now</span><span className="keyboard-hint"><kbd>⌘</kbd><kbd>K</kbd> command menu</span></div></header>
}

function PageIntro({ activeView }) {
  const copy = pageCopy[activeView]
  return <section className="page-intro"><div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p className="page-description">{copy.description}</p></div><div className="intro-mark" aria-hidden="true"><span className="intro-orbit orbit-one" /><span className="intro-orbit orbit-two" /><span className="intro-core">{activeView === 'review' ? '⌁' : activeView === 'evaluations' ? '◒' : '✦'}</span></div></section>
}

function WorkspaceStats({ sessions }) {
  const toolCalls = sessions.reduce((sum, session) => sum + session.toolCalls, 0)
  const attention = sessions.filter((session) => session.status === 'attention').length
  return <div className="workspace-stats" aria-label="Workspace summary"><div><span>Captured sessions</span><strong>{String(sessions.length).padStart(2, '0')}</strong><small>last 24 hours</small></div><div><span>Tool calls reviewed</span><strong>{toolCalls}</strong><small>across current sample</small></div><div><span>Needs attention</span><strong className={attention ? 'text-amber' : 'text-green'}>{String(attention).padStart(2, '0')}</strong><small>{attention ? 'open review signal' : 'all clear'}</small></div><div><span>Latest capture</span><strong>09:22</strong><small>2 minutes ago</small></div></div>
}

function ReferenceView() {
  return <section className="secondary-page" aria-labelledby="reference-title"><div className="secondary-heading"><div><p className="section-label">Trusted examples</p><h2 id="reference-title">Trusted trace reference set</h2><p>These are the traces your team has already agreed are worth emulating. Use them to calibrate reviews and spot regressions.</p></div><span className="record-count">28 examples</span></div><div className="reference-panel panel"><div className="reference-table-head"><span>Example</span><span>Category</span><span>Score</span><span>Last reviewed</span></div>{referenceRows.map((row) => <div className="reference-row" key={row.id}><div><strong>{row.title}</strong><small>{row.id}</small></div><span className="trace-tag blue">{row.category}</span><strong className="text-green">{row.score}</strong><span>{row.reviewed}</span><span className="row-arrow" aria-hidden="true">↗</span></div>)}</div><div className="method-note"><span className="method-icon">✦</span><div><strong>Why keep a reference set?</strong><p>A passing eval tells you what happened. A trusted trace shows the team what good looks like, including the reasoning and tool choices.</p></div></div></section>
}

function EvaluationView({ sessions, onNavigate }) {
  const total = sessions.reduce((sum, session) => sum + session.insights.evalTotal, 0)
  const passed = sessions.reduce((sum, session) => sum + session.insights.evalPasses, 0)
  const alignment = Math.round(sessions.reduce((sum, session) => sum + session.insights.judgeAlignment, 0) / sessions.length)
  return <section className="secondary-page" aria-labelledby="evaluation-title"><div className="secondary-heading"><div><p className="section-label">Quality overview</p><h2 id="evaluation-title">Evaluation workspace</h2><p>Read the aggregate signal first, then jump into a session when a check and a judge disagree.</p></div><button type="button" className="text-button" onClick={() => onNavigate('review')}>Review a session <span aria-hidden="true">↗</span></button></div><div className="evaluation-overview"><div className="evaluation-number"><span>Sample eval pass rate</span><strong>{passed}/{total}</strong><small>checks passing in the captured sample</small></div><div className="evaluation-number purple"><span>Average judge alignment</span><strong>{alignment}%</strong><small>agreement with human review labels</small></div><div className="evaluation-method"><span className="section-label">How to read this</span><p>Deterministic checks catch regressions. Judge alignment tells you whether those checks still describe a useful run.</p></div></div><InsightCards insights={{ evalPasses: passed, evalTotal: total, judgeAlignment: alignment, reviewSignal: 'Stable' }} /></section>
}

export default function App() {
  const [activeView, setActiveView] = useState(() => viewFromHash())
  const [sessions, setSessions] = useState(demoSessions)
  const [selectedId, setSelectedId] = useState(demoSessions[0].id)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [apiState, setApiState] = useState('demo')

  useEffect(() => {
    const onHashChange = () => setActiveView(viewFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    let mounted = true
    Promise.resolve().then(() => getHealth()).then(() => {
      if (mounted) setApiState('connected')
    }).catch(() => {
      if (mounted) setApiState('demo')
    })
    Promise.resolve().then(() => getSessions()).then((payload) => {
      if (mounted && Array.isArray(payload?.sessions) && payload.sessions.length) setSessions(payload.sessions)
    }).catch(() => {})
    return () => { mounted = false }
  }, [])

  const visibleSessions = useMemo(() => sessions.filter((session) => {
    const matchesFilter = filter === 'all' || session.status === filter
    const text = `${session.title} ${session.id} ${session.latestTool}`.toLowerCase()
    return matchesFilter && text.includes(query.toLowerCase())
  }), [filter, query, sessions])

  const activeSelectedId = visibleSessions.some((session) => session.id === selectedId) ? selectedId : visibleSessions[0]?.id
  const selectedSession = sessions.find((session) => session.id === activeSelectedId) || visibleSessions[0] || sessions[0]

  function navigate(view) {
    setActiveView(view)
    window.location.hash = `/${view}`
  }

  return <div className="app-shell"><Sidebar activeView={activeView} onNavigate={navigate} apiState={apiState} /><main className="main-content"><Topbar activeView={activeView} /><PageIntro activeView={activeView} />{activeView === 'review' && selectedSession && <><WorkspaceStats sessions={sessions} /><div className="review-layout"><SessionList sessions={sessions} selectedId={activeSelectedId} onSelect={setSelectedId} query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} /><TraceView session={selectedSession} /><InsightCards insights={selectedSession.insights} /></div></>}{activeView === 'evaluations' && <EvaluationView sessions={sessions} onNavigate={navigate} />}{activeView === 'reference' && <ReferenceView />}</main></div>
}
