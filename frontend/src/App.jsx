import { useEffect, useMemo, useState } from 'react'

const navItems = [
  { id: 'sessions', label: 'Sessions', count: '12', icon: '◌' },
  { id: 'evals', label: 'Evals', count: '04', icon: '↗' },
  { id: 'golden', label: 'Golden Set', count: '28', icon: '✳' },
]

const viewContent = {
  sessions: {
    eyebrow: 'Trace workspace / Sessions',
    title: 'Read the trace before the failure.',
    description:
      'A quiet place to follow what the agent saw, chose, and changed — one captured run at a time.',
  },
  evals: {
    eyebrow: 'Trace workspace / Evals',
    title: 'Measure what good looks like.',
    description:
      'Keep deterministic checks and human judgement in the same line of sight as the sessions they explain.',
  },
  golden: {
    eyebrow: 'Trace workspace / Golden Set',
    title: 'Keep the reference close.',
    description:
      'A small, trusted collection of labelled traces gives every new evaluation a stable point of comparison.',
  },
}

const sessions = [
  {
    id: 'sess_8f24',
    label: 'Build the React shell',
    status: 'captured',
    age: '2 min ago',
    events: 38,
    tools: 12,
    latest: 'apply_patch',
  },
  {
    id: 'sess_4c19',
    label: 'Review auth boundary',
    status: 'captured',
    age: '18 min ago',
    events: 24,
    tools: 8,
    latest: 'linear_get_issue',
  },
  {
    id: 'sess_1b07',
    label: 'Trace proxy failure',
    status: 'attention',
    age: '1 hr ago',
    events: 17,
    tools: 6,
    latest: 'shell_command',
  },
]

const evalModes = {
  latest: {
    score: '92.6',
    period: 'latest 40 sessions',
    updated: '8 min ago',
    checks: [
      { label: 'Files read before write', value: '98.4%', tone: 'lilac' },
      { label: 'Tool budget respected', value: '94.1%', tone: 'blue' },
      { label: 'Human label agreement', value: '91.8%', tone: 'amber' },
    ],
  },
  baseline: {
    score: '89.8',
    period: 'baseline 120 sessions',
    updated: 'yesterday',
    checks: [
      { label: 'Files read before write', value: '96.7%', tone: 'lilac' },
      { label: 'Tool budget respected', value: '92.5%', tone: 'blue' },
      { label: 'Human label agreement', value: '89.1%', tone: 'amber' },
    ],
  },
}

const goldenRows = [
  { id: 'gold_014', label: 'Correctly routes API errors', tag: 'routing', reviewed: 'Today' },
  { id: 'gold_011', label: 'Reads context before editing', tag: 'workflow', reviewed: 'Yesterday' },
  { id: 'gold_008', label: 'Keeps secrets out of the client', tag: 'security', reviewed: 'Aug 12' },
]

function viewFromHash(hash = window.location.hash) {
  const candidate = hash.replace('#', '')
  return navItems.some((item) => item.id === candidate) ? candidate : 'sessions'
}

function StatusChip({ tone = 'lilac', children }) {
  return <span className={`status-chip ${tone}`}>{children}</span>
}

function NavLink({ item, activeView, onNavigate }) {
  const isActive = activeView === item.id

  return (
    <a
      className={`nav-link ${isActive ? 'is-active' : ''}`}
      href={`#${item.id}`}
      aria-current={isActive ? 'page' : undefined}
      onClick={() => onNavigate(item.id)}
    >
      <span className="nav-link-icon" aria-hidden="true">{item.icon}</span>
      <span>{item.label}</span>
      <span className="nav-count">{item.count}</span>
    </a>
  )
}

function Sidebar({ activeView, onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
        <div>
          <p className="brand-name">Nala Trace</p>
          <p className="brand-subtitle">agent observability</p>
        </div>
      </div>

      <div className="workspace-switcher" aria-label="Current workspace">
        <span className="workspace-avatar">NL</span>
        <span className="workspace-name"><small>Workspace</small><strong>Nala Labs</strong></span>
        <span className="chevron" aria-hidden="true">⌄</span>
      </div>

      <nav className="primary-nav" aria-label="Primary navigation">
        <p className="nav-label">Observe</p>
        {navItems.map((item) => (
          <NavLink key={item.id} item={item} activeView={activeView} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="sidebar-footer">
        <span className="mini-signal" aria-hidden="true" />
        <span>Development mode</span>
        <span className="footer-version">v0.1</span>
      </div>
    </aside>
  )
}

function Topbar({ activeView }) {
  return (
    <header className="topbar">
      <div className="breadcrumb" aria-label="Breadcrumb">
        <span>Workspace</span><b>/</b><strong>{viewContent[activeView].eyebrow.split(' / ')[1]}</strong>
      </div>
      <div className="topbar-status">
        <span className="proxy-status"><span className="live-dot" /> proxy ready</span>
        <span className="proxy-path">/api <b>→</b> local Go service</span>
      </div>
    </header>
  )
}

function TracePulse() {
  return (
    <div className="trace-pulse" aria-label="Live trace pulse">
      <div className="pulse-orbit pulse-orbit-one" />
      <div className="pulse-orbit pulse-orbit-two" />
      <div className="pulse-core"><span>NT</span></div>
      <div className="pulse-bars" aria-hidden="true">
        <i style={{ height: '35%' }} /><i style={{ height: '58%' }} /><i style={{ height: '44%' }} />
        <i className="is-hot" style={{ height: '84%' }} /><i style={{ height: '64%' }} /><i style={{ height: '49%' }} />
      </div>
      <span className="pulse-caption">signal / 01</span>
    </div>
  )
}

function Hero({ activeView, onNavigate }) {
  const currentView = viewContent[activeView]

  return (
    <section className="hero" aria-labelledby="page-title">
      <div className="hero-copy">
        <p className="eyebrow">{currentView.eyebrow}</p>
        <h1 id="page-title">{currentView.title}</h1>
        <p className="hero-description">{currentView.description}</p>
        <a className="hero-link" href="#sessions" onClick={() => onNavigate('sessions')}>
          Open session explorer <span aria-hidden="true">↗</span>
        </a>
      </div>
      <TracePulse />
    </section>
  )
}

function SummaryStrip() {
  return (
    <section className="stat-strip" aria-label="Workspace summary">
      <div className="stat-card"><strong>12</strong><span>captured sessions</span></div>
      <div className="stat-card"><strong>04</strong><span>active evals</span></div>
      <div className="stat-card"><strong>28</strong><span>golden traces</span></div>
      <div className="stat-note"><span className="live-dot" />Last event received <strong>2m ago</strong></div>
    </section>
  )
}

function SessionsView() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(sessions[0].id)
  const filteredSessions = useMemo(() => sessions.filter((session) => {
    const matchesFilter = filter === 'all' || session.status === filter
    const searchable = `${session.label} ${session.id} ${session.latest}`.toLowerCase()
    return matchesFilter && searchable.includes(query.toLowerCase())
  }), [filter, query])
  const selectedSession = filteredSessions.find((session) => session.id === selectedId) || filteredSessions[0]

  return (
    <div className="content-grid sessions-grid">
      <section className="panel session-index" aria-labelledby="sessions-heading">
        <div className="panel-heading panel-heading-stack">
          <div>
            <p className="panel-kicker">Session index / 03 shown</p>
            <h2 id="sessions-heading">Stay close to the evidence.</h2>
          </div>
          <label className="search-field">
            <span className="sr-only">Search sessions</span>
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search traces" />
          </label>
        </div>
        <div className="filter-bar" aria-label="Session filters">
          {['all', 'attention'].map((option) => (
            <button
              className={`filter-button ${filter === option ? 'is-selected' : ''}`}
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
            >
              {option === 'all' ? 'All traces' : 'Needs review'}
              <span>{option === 'all' ? '03' : '01'}</span>
            </button>
          ))}
        </div>
        <div className="session-list" role="list">
          {filteredSessions.length > 0 ? filteredSessions.map((session) => (
            <div className="session-row-wrap" key={session.id} role="listitem">
              <button
                className={`session-row ${selectedSession?.id === session.id ? 'is-selected' : ''}`}
                type="button"
                aria-pressed={selectedSession?.id === session.id}
                onClick={() => setSelectedId(session.id)}
              >
                <span className={`status-dot ${session.status}`} aria-hidden="true" />
                <span className="session-main"><strong>{session.label}</strong><span>{session.id}</span></span>
                <span className="session-meta"><span>{session.age}</span><span>{session.events} events</span></span>
                <span className="row-arrow" aria-hidden="true">↗</span>
              </button>
            </div>
          )) : (
            <p className="empty-state">No traces match “{query}”.</p>
          )}
        </div>
      </section>

      <aside className="panel detail-panel" aria-labelledby="detail-heading">
        <div className="panel-heading">
          <div><p className="panel-kicker">Selected trace</p><h2 id="detail-heading">{selectedSession?.label || 'No trace selected'}</h2></div>
          <StatusChip tone={selectedSession?.status === 'attention' ? 'amber' : 'lilac'}>
            {selectedSession?.status === 'attention' ? 'review' : 'captured'}
          </StatusChip>
        </div>
        {selectedSession ? (
          <div className="detail-body">
            <div className="detail-code"><span>trace_id</span><strong>{selectedSession.id}</strong></div>
            <div className="detail-metrics">
              <div><strong>{selectedSession.events}</strong><span>events</span></div>
              <div><strong>{selectedSession.tools}</strong><span>tool calls</span></div>
              <div><strong>{selectedSession.age.replace(' ago', '')}</strong><span>last seen</span></div>
            </div>
            <div className="latest-event"><span className="event-marker" /><span><small>Latest event</small><strong>{selectedSession.latest}</strong></span><StatusChip tone="blue">done</StatusChip></div>
          </div>
        ) : <p className="empty-state">Select a trace to inspect its signal.</p>}
      </aside>

      <section className="panel signal-panel" aria-labelledby="signal-heading">
        <div className="panel-heading">
          <div><p className="panel-kicker">Stream monitor</p><h2 id="signal-heading">The last 60 minutes.</h2></div>
          <StatusChip tone="blue"><span className="live-dot" /> live</StatusChip>
        </div>
        <div className="signal-chart" aria-label="Captured event signal over the last hour">
          <div className="signal-lines" aria-hidden="true" />
          <div className="signal-bars" aria-hidden="true">
            <i style={{ height: '32%' }} /><i style={{ height: '48%' }} /><i style={{ height: '42%' }} />
            <i style={{ height: '70%' }} /><i style={{ height: '54%' }} /><i className="is-hot" style={{ height: '88%' }} />
            <i style={{ height: '61%' }} /><i style={{ height: '76%' }} /><i style={{ height: '44%' }} /><i style={{ height: '66%' }} />
            <i style={{ height: '50%' }} /><i style={{ height: '82%' }} />
          </div>
        </div>
        <div className="chart-axis"><span>−60m</span><span>now</span></div>
        <div className="signal-note"><span className="signal-note-mark">!</span><span>One session needs a second look.</span></div>
      </section>
    </div>
  )
}

function EvalsView({ onNavigate }) {
  const [mode, setMode] = useState('latest')
  const currentMode = evalModes[mode]

  return (
    <div className="content-grid evals-grid">
      <section className="panel score-panel" aria-labelledby="evals-heading">
        <div className="panel-heading panel-heading-stack">
          <div><p className="panel-kicker">Evaluation signal</p><h2 id="evals-heading">A healthy signal, with edges.</h2></div>
          <div className="segmented-control" role="group" aria-label="Evaluation range">
            {Object.keys(evalModes).map((option) => (
              <button key={option} type="button" className={mode === option ? 'is-selected' : ''} aria-pressed={mode === option} onClick={() => setMode(option)}>
                {option === 'latest' ? 'Latest' : 'Baseline'}
              </button>
            ))}
          </div>
        </div>
        <div className="score-lockup"><strong>{currentMode.score}</strong><span>/ 100</span></div>
        <div className="score-orbit" aria-hidden="true"><span>PASS</span></div>
        <p className="panel-copy">The {currentMode.period} hold steady. Review the checks below when a trace drifts.</p>
        <div className="score-footer"><span>Last refreshed {currentMode.updated}</span><a href="#sessions" onClick={() => onNavigate('sessions')}>Review evidence <span aria-hidden="true">↗</span></a></div>
      </section>

      <section className="panel checks-panel" aria-labelledby="checks-heading">
        <div className="panel-heading"><div><p className="panel-kicker">Code-based checks</p><h2 id="checks-heading">Where the score comes from.</h2></div><StatusChip tone="lilac">3 signals</StatusChip></div>
        <div className="check-list">
          {currentMode.checks.map((check) => (
            <div className="check-row" key={check.label}>
              <span className={`check-marker ${check.tone}`} />
              <span>{check.label}</span>
              <strong>{check.value}</strong>
            </div>
          ))}
        </div>
        <div className="checks-footnote"><span className="info-mark">i</span><span>Deterministic checks are paired with human labels before they become a gate.</span></div>
      </section>
    </div>
  )
}

function GoldenSetView() {
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('all')
  const [selectedId, setSelectedId] = useState(goldenRows[0].id)
  const tags = ['all', ...new Set(goldenRows.map((row) => row.tag))]
  const filteredRows = useMemo(() => goldenRows.filter((row) => {
    const matchesTag = tag === 'all' || row.tag === tag
    return matchesTag && `${row.label} ${row.id} ${row.tag}`.toLowerCase().includes(query.toLowerCase())
  }), [query, tag])
  const selectedRow = goldenRows.find((row) => row.id === selectedId)

  return (
    <section className="panel golden-panel" aria-labelledby="golden-heading">
      <div className="panel-heading panel-heading-stack">
        <div><p className="panel-kicker">Labelled reference traces</p><h2 id="golden-heading">The examples worth protecting.</h2></div>
        <label className="search-field"><span className="sr-only">Search golden set</span><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search records" /></label>
      </div>
      <div className="filter-bar golden-filters" aria-label="Golden set filters">
        {tags.map((option) => (
          <button key={option} type="button" className={`filter-button ${tag === option ? 'is-selected' : ''}`} aria-pressed={tag === option} onClick={() => setTag(option)}>
            {option === 'all' ? 'All records' : option}
          </button>
        ))}
      </div>
      <div className="golden-list" role="list">
        {filteredRows.length > 0 ? filteredRows.map((row, index) => (
          <div className="golden-row-wrap" key={row.id} role="listitem">
            <button className={`golden-row ${selectedId === row.id ? 'is-selected' : ''}`} type="button" aria-pressed={selectedId === row.id} onClick={() => setSelectedId(row.id)}>
              <span className="golden-index">0{index + 1}</span>
              <span className="golden-main"><strong>{row.label}</strong><span>{row.id}</span></span>
              <StatusChip tone="blue">{row.tag}</StatusChip>
              <span className="golden-reviewed">Reviewed {row.reviewed}</span>
              <span className="row-arrow" aria-hidden="true">↗</span>
            </button>
          </div>
        )) : <p className="empty-state">No reference traces match “{query}”.</p>}
      </div>
      <div className="golden-footer"><span className="lock-mark" aria-hidden="true">✦</span><span>Golden traces stay versioned so evals can move without moving the goalposts.</span><strong aria-live="polite">Selected: {selectedRow?.id || 'none'}</strong></div>
    </section>
  )
}

function ViewContent({ activeView, onNavigate }) {
  if (activeView === 'evals') return <EvalsView onNavigate={onNavigate} />
  if (activeView === 'golden') return <GoldenSetView />
  return <SessionsView />
}

export default function App() {
  const [activeView, setActiveView] = useState(() => viewFromHash())

  const navigate = (view) => {
    setActiveView(view)
    if (window.location.hash !== `#${view}`) window.location.hash = view
  }

  useEffect(() => {
    const handleHashChange = () => setActiveView(viewFromHash())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onNavigate={navigate} />
      <main className="main-content">
        <Topbar activeView={activeView} />
        <Hero activeView={activeView} onNavigate={navigate} />
        <SummaryStrip />
        <ViewContent activeView={activeView} onNavigate={navigate} />
      </main>
    </div>
  )
}
