import { filterSessionSummaries, sortSessionSummaries } from '../sessionSummaries'

const filters = [
  { id: 'all', label: 'All sessions' },
  { id: 'attention', label: 'Needs review' },
  { id: 'passed', label: 'Passed' },
]

function CountBadge({ value, label, accessibleLabel = label }) {
  return <span className="count-badge" aria-label={`${value} ${accessibleLabel}`}><strong>{value}</strong><span>{label}</span></span>
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
  sortBy,
  onSortChange,
}) {
  const filteredSessions = filterSessionSummaries(sessions, query, filter)
  const visibleSessions = sortSessionSummaries(filteredSessions, sortBy)
  const hasFilters = Boolean(query.trim()) || filter !== 'all'

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
            placeholder="Search titles, IDs, dates, counts, or status"
          />
          {query && <button type="button" className="clear-search" onClick={() => onQueryChange('')} aria-label="Clear search">×</button>}
        </label>
        <div className="session-control-actions">
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
          <label className="sort-control">
            <span>Sort</span>
            <select value={sortBy} onChange={(event) => onSortChange(event.target.value)} aria-label="Sort sessions">
              <option value="recent">Most recent</option>
              <option value="tools">Most tool calls</option>
              <option value="events">Most events</option>
            </select>
          </label>
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
            aria-label={sessionAccessibleLabel(session)}
            className={`session-record ${selectedId === session.id ? 'is-selected' : ''}`}
            aria-pressed={selectedId === session.id}
            onClick={() => onSelect(session.id)}
          >
            <span className="session-record-main">
              <span className="session-record-title"><strong>{sessionTitle(session)}</strong><StatusBadge status={session.status} /></span>
              <span className="session-record-id">{session.id}</span>
            </span>
            <span className="session-counts" aria-label={`${session.toolCallCount} tool calls, ${session.mcpCallCount} MCP calls, ${session.skillInvocationCount} skills, ${session.fileOperationCount} files`}>
              <CountBadge value={session.toolCallCount} label="tools" />
              <CountBadge value={session.mcpCallCount} label="MCP" accessibleLabel="MCP calls" />
              <CountBadge value={session.skillInvocationCount} label="skills" />
              <CountBadge value={session.fileOperationCount} label="files" />
              <span className="session-mcp-servers" aria-label={`MCP servers used: ${formatMcpServers(session)}`} title={`MCP servers used: ${formatMcpServers(session)}`}>
                MCP servers: {formatMcpServers(session)}
              </span>
            </span>
            <span className="session-last-event"><strong>{session.eventCount.toLocaleString()} events</strong><span>{formatDate(session.lastEventAt)}</span></span>
            <span className="session-captured">{formatDate(session.firstEventAt)}<span className="row-arrow" aria-hidden="true">↗</span></span>
          </button>
        )) : (
          <div className="empty-records" role="status">
            <strong>{hasFilters ? 'No sessions match your filters.' : 'No sessions captured yet.'}</strong>
            <span>{hasFilters ? 'Try a different search or show all sessions.' : 'New authenticated traces will appear here.'}</span>
          </div>
        )}
      </div>
    </section>
  )
}

function formatDate(value) {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function sessionTitle(session) {
  return typeof session.title === 'string' && session.title.trim() ? session.title.trim() : session.id || 'Untitled session'
}

function sessionAccessibleLabel(session) {
  const title = sessionTitle(session)
  return title === session.id ? `Open session ${title}` : `Open session ${title} (${session.id})`
}

function formatMcpServers(session) {
  const servers = Array.isArray(session.mcpServers) ? session.mcpServers.filter((server) => typeof server === 'string' && server.trim()) : []
  return servers.length ? servers.join(' · ') : 'none recorded'
}
