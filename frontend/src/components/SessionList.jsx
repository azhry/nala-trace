const filters = [
  { id: 'all', label: 'All sessions' },
  { id: 'attention', label: 'Needs review' },
  { id: 'passed', label: 'Passed' },
]

function CountBadge({ value, label }) {
  return <span className="count-badge"><strong>{value}</strong><span>{label}</span></span>
}

function StatusBadge({ status }) {
  const label = status === 'attention' ? 'Needs review' : status === 'passed' ? 'Passed' : 'Captured'
  return <span className={`status-badge ${status}`}><span className="status-dot" />{label}</span>
}

export default function SessionList({
  sessions,
  selectedId,
  onSelect,
  query,
  onQueryChange,
  filter,
  onFilterChange,
}) {
  const visibleSessions = sessions.filter((session) => {
    const matchesFilter = filter === 'all' || session.status === filter
    const text = `${session.title} ${session.id} ${session.latestTool}`.toLowerCase()
    return matchesFilter && text.includes(query.toLowerCase())
  })

  return (
    <section className="panel session-list-panel" aria-labelledby="session-list-title">
      <div className="panel-header session-list-header">
        <div>
          <p className="section-label">Records</p>
          <h2 id="session-list-title">Session records</h2>
          <p className="panel-description">Every row is a captured session. Select one to open the complete detail view.</p>
        </div>
        <span className="record-count">{visibleSessions.length} of {sessions.length}</span>
      </div>

      <div className="session-controls">
        <label className="search-box">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <span className="sr-only">Search sessions</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search by title, id, or tool"
          />
          {query && <button type="button" className="clear-search" onClick={() => onQueryChange('')} aria-label="Clear search">×</button>}
        </label>
        <div className="filter-tabs" role="group" aria-label="Filter sessions">
          {filters.map((option) => (
            <button
              key={option.id}
              type="button"
              className={filter === option.id ? 'is-active' : ''}
              aria-pressed={filter === option.id}
              onClick={() => onFilterChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="records-table" role="list" aria-label="Trace sessions">
        <div className="records-table-head" aria-hidden="true">
          <span>Session</span><span>Signal</span><span>Last event</span><span>Captured</span>
        </div>
        {visibleSessions.length ? visibleSessions.map((session) => (
          <button
            key={session.id}
            type="button"
            aria-label={session.title}
            className={`session-record ${selectedId === session.id ? 'is-selected' : ''}`}
            aria-pressed={selectedId === session.id}
            onClick={() => onSelect(session.id)}
          >
            <span className="session-record-main">
              <span className="session-record-title"><strong>{session.title}</strong><StatusBadge status={session.status} /></span>
              <span className="session-record-id">{session.id} · {session.duration}</span>
            </span>
            <span className="session-counts" aria-label={`${session.toolCalls} tool calls, ${session.skills} skills, ${session.files} files`}>
              <CountBadge value={session.toolCalls} label="tools" />
              <CountBadge value={session.skills} label="skills" />
              <CountBadge value={session.files} label="files" />
            </span>
            <span className="session-last-event"><strong>{session.latestTool}</strong><span>{session.latestTime}</span></span>
            <span className="session-captured">{session.capturedAt}<span className="row-arrow" aria-hidden="true">↗</span></span>
          </button>
        )) : (
          <div className="empty-records">
            <strong>No sessions match that filter.</strong>
            <span>Try a different search or show all sessions.</span>
          </div>
        )}
      </div>
    </section>
  )
}
