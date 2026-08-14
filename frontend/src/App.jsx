import { useEffect, useState } from 'react'

const navItems = [
  { id: 'sessions', label: 'Sessions', count: '12' },
  { id: 'evals', label: 'Evals', count: '04' },
  { id: 'golden', label: 'Golden Set', count: '28' },
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
  { id: 'sess_8f24', label: 'Build the React shell', status: 'captured', age: '2 min ago', events: '38 events' },
  { id: 'sess_4c19', label: 'Review auth boundary', status: 'captured', age: '18 min ago', events: '24 events' },
  { id: 'sess_1b07', label: 'Trace proxy failure', status: 'attention', age: '1 hr ago', events: '17 events' },
]

const evalChecks = [
  { label: 'Files read before write', value: '98.4%', tone: 'lime' },
  { label: 'Tool budget respected', value: '94.1%', tone: 'blue' },
  { label: 'Human label agreement', value: '91.8%', tone: 'coral' },
]

const goldenRows = [
  { id: 'gold_014', label: 'Correctly routes API errors', tag: 'routing', reviewed: 'Today' },
  { id: 'gold_011', label: 'Reads context before editing', tag: 'workflow', reviewed: 'Yesterday' },
  { id: 'gold_008', label: 'Keeps secrets out of the client', tag: 'security', reviewed: 'Aug 12' },
]

function viewFromHash(hash = window.location.hash) {
  const candidate = hash.replace('#', '')
  return navItems.some((item) => item.id === candidate) ? candidate : 'sessions'
}

function NavLink({ item, activeView, onNavigate }) {
  return (
    <a
      className={`nav-link ${activeView === item.id ? 'is-active' : ''}`}
      href={`#${item.id}`}
      aria-current={activeView === item.id ? 'page' : undefined}
      onClick={() => onNavigate(item.id)}
    >
      <span className="nav-link-icon" aria-hidden="true">
        {item.id === 'sessions' ? '◌' : item.id === 'evals' ? '↗' : '✳'}
      </span>
      <span>{item.label}</span>
      <span className="nav-count">{item.count}</span>
    </a>
  )
}

function SessionsView() {
  return (
    <div className="content-grid">
      <section className="panel sessions-panel" aria-labelledby="sessions-heading">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Recent captures</p>
            <h2 id="sessions-heading">Stay close to the evidence.</h2>
          </div>
          <span className="panel-tag">12 total</span>
        </div>
        <div className="session-list" role="list">
          {sessions.map((session) => (
            <div className="session-row" key={session.id} role="listitem">
              <span className={`status-dot ${session.status}`} aria-label={session.status} />
              <div className="session-main">
                <strong>{session.label}</strong>
                <span>{session.id}</span>
              </div>
              <div className="session-meta">
                <span>{session.age}</span>
                <span>{session.events}</span>
              </div>
              <span className="row-arrow" aria-hidden="true">↗</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel signal-panel" aria-labelledby="signal-heading">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Live signal</p>
            <h2 id="signal-heading">The last 60 minutes.</h2>
          </div>
          <span className="signal-live"><span className="live-dot" /> live</span>
        </div>
        <div className="signal-chart" aria-label="Captured event signal over the last hour">
          <div className="signal-lines" aria-hidden="true" />
          <div className="signal-bars" aria-hidden="true">
            <i style={{ height: '32%' }} />
            <i style={{ height: '48%' }} />
            <i style={{ height: '42%' }} />
            <i style={{ height: '70%' }} />
            <i style={{ height: '54%' }} />
            <i className="is-hot" style={{ height: '88%' }} />
            <i style={{ height: '61%' }} />
            <i style={{ height: '76%' }} />
            <i style={{ height: '44%' }} />
            <i style={{ height: '66%' }} />
            <i style={{ height: '50%' }} />
            <i style={{ height: '82%' }} />
          </div>
        </div>
        <div className="chart-axis"><span>−60m</span><span>now</span></div>
        <div className="signal-note"><span className="signal-note-mark">!</span><span>One session needs a second look.</span></div>
      </section>
    </div>
  )
}

function EvalsView() {
  return (
    <div className="content-grid evals-grid">
      <section className="panel score-panel" aria-labelledby="evals-heading">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Current baseline</p>
            <h2 id="evals-heading">A healthy signal, with edges.</h2>
          </div>
          <span className="score-badge">92.6 <small>/ 100</small></span>
        </div>
        <div className="score-orbit" aria-hidden="true"><span>PASS</span></div>
        <p className="panel-copy">The baseline holds across the latest 40 sessions. Review the three checks below when a trace drifts.</p>
      </section>
      <section className="panel checks-panel" aria-labelledby="checks-heading">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Code-based checks</p>
            <h2 id="checks-heading">Where the score comes from.</h2>
          </div>
        </div>
        <div className="check-list">
          {evalChecks.map((check) => (
            <div className="check-row" key={check.label}>
              <span className={`check-marker ${check.tone}`} />
              <span>{check.label}</span>
              <strong>{check.value}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function GoldenSetView() {
  return (
    <section className="panel golden-panel" aria-labelledby="golden-heading">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Labelled reference traces</p>
          <h2 id="golden-heading">The examples worth protecting.</h2>
        </div>
        <span className="panel-tag golden-tag">28 locked</span>
      </div>
      <div className="golden-list" role="list">
        {goldenRows.map((row, index) => (
          <div className="golden-row" key={row.id} role="listitem">
            <span className="golden-index">0{index + 1}</span>
            <div className="golden-main"><strong>{row.label}</strong><span>{row.id}</span></div>
            <span className="golden-label">{row.tag}</span>
            <span className="golden-reviewed">Reviewed {row.reviewed}</span>
            <span className="row-arrow" aria-hidden="true">↗</span>
          </div>
        ))}
      </div>
      <div className="golden-footer"><span className="lock-mark" aria-hidden="true">✦</span><span>Golden traces stay versioned so evals can move without moving the goalposts.</span></div>
    </section>
  )
}

function ViewContent({ activeView }) {
  if (activeView === 'evals') return <EvalsView />
  if (activeView === 'golden') return <GoldenSetView />
  return <SessionsView />
}

export default function App() {
  const [activeView, setActiveView] = useState(() => viewFromHash())
  const currentView = viewContent[activeView]

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
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div><p className="brand-name">Nala Trace</p><p className="brand-subtitle">agent observability</p></div>
        </div>
        <div className="workspace-switcher"><span className="workspace-avatar">NL</span><span><small>Workspace</small><strong>Nala Labs</strong></span><span className="chevron" aria-hidden="true">⌄</span></div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <p className="nav-label">Observe</p>
          {navItems.map((item) => <NavLink key={item.id} item={item} activeView={activeView} onNavigate={navigate} />)}
        </nav>
        <div className="sidebar-footer"><span className="mini-signal" aria-hidden="true" /><span>Development mode</span><span className="footer-version">v0.1</span></div>
      </aside>
      <main className="main-content">
        <header className="topbar"><span className="breadcrumb"><span>Workspace</span><b>/</b>{currentView.eyebrow.split(' / ')[1]}</span><div className="topbar-status"><span className="proxy-status"><span className="live-dot" /> proxy ready</span><span className="proxy-path">/api → local Go service</span></div></header>
        <section className="hero" aria-labelledby="page-title">
          <div className="hero-copy"><p className="eyebrow">{currentView.eyebrow}</p><h1 id="page-title">{currentView.title}</h1><p className="hero-description">{currentView.description}</p><a className="hero-link" href="#sessions" onClick={() => navigate('sessions')}>Open session explorer <span aria-hidden="true">↗</span></a></div>
          <div className="hero-signal" aria-hidden="true"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-core"><span>NT</span></div><span className="hero-caption">signal / 01</span></div>
        </section>
        <section className="stat-strip" aria-label="Workspace summary"><div><strong>12</strong><span>captured sessions</span></div><div><strong>04</strong><span>active evals</span></div><div><strong>28</strong><span>golden traces</span></div><div className="stat-note"><span className="live-dot" />Last event received <strong>2m ago</strong></div></section>
        <ViewContent activeView={activeView} />
      </main>
    </div>
  )
}
