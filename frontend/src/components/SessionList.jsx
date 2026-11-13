import { useRef } from 'react'
import { Button } from '@ui-sdk/react/button'
import { Field, FieldLabel } from '@ui-sdk/react/field'
import { Input } from '@ui-sdk/react/input'
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/react/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui-sdk/react/select'
import { filterSessionSummaries, sortSessionSummaries } from '../sessionSummaries'

const filters = [
  { id: 'all', label: 'All sessions' },
  { id: 'attention', label: 'Needs review' },
  { id: 'passed', label: 'Passed' },
]

function StatusBadge({ status }) {
  const label = status === 'attention' ? 'Needs review' : status === 'passed' ? 'Passed' : 'Captured'
  return <span className={'record-status record-status--' + status}><span />{label}</span>
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
  return title === session.id ? 'Open session ' + title : 'Open session ' + title + ' (' + session.id + ')'
}

function formatMcpServers(session) {
  const servers = Array.isArray(session.mcpServers) ? session.mcpServers.filter((server) => typeof server === 'string' && server.trim()) : []
  return servers.length ? servers.join(' · ') : 'none recorded'
}

function SessionRecord({ session, selected, onSelect }) {
  return <li className="session-record-item">
    <Button
      className={'session-record' + (selected ? ' is-selected' : '')}
      aria-label={sessionAccessibleLabel(session)}
      aria-pressed={selected}
      onClick={() => onSelect(session.id)}
    >
      <span className="session-record__identity">
        <span className="session-record__title"><strong>{sessionTitle(session)}</strong><StatusBadge status={session.status} /></span>
        <code>{session.id}</code>
      </span>
      <span className="session-record__evidence" role="group" aria-label="Recorded evidence counts">
        <span aria-label={session.toolCallCount + ' tools'}><strong>{session.toolCallCount.toLocaleString()}</strong><small>tools</small></span>
        <span aria-label={session.mcpCallCount + ' MCP calls'}><strong>{session.mcpCallCount.toLocaleString()}</strong><small>MCP</small></span>
        <span aria-label={session.skillInvocationCount + ' skills'}><strong>{session.skillInvocationCount.toLocaleString()}</strong><small>skills</small></span>
        <span aria-label={session.fileOperationCount + ' files'}><strong>{session.fileOperationCount.toLocaleString()}</strong><small>files</small></span>
        <small className="session-record__servers" title={'MCP servers: ' + formatMcpServers(session)}>{session.mcpServers?.length ? session.mcpServers.join(' · ') : 'No MCP servers recorded'}</small>
      </span>
      <span className="session-record__event"><strong>{session.eventCount.toLocaleString()} events</strong><small>{formatDate(session.lastEventAt)}</small></span>
      <span className="session-record__captured"><small>FIRST CAPTURE</small><strong>{formatDate(session.firstEventAt)}</strong></span>
      <span className="session-record__arrow" aria-hidden="true">↗</span>
    </Button>
  </li>
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
  onRetry,
}) {
  const searchInputRef = useRef(null)
  const filteredSessions = filterSessionSummaries(sessions, query, filter)
  const visibleSessions = sortSessionSummaries(filteredSessions, sortBy)
  const hasFilters = Boolean(query.trim()) || filter !== 'all'
  const resetFilters = () => {
    onQueryChange('')
    onFilterChange('all')
  }

  return <section className="trace-records-panel" aria-labelledby="session-list-title">
    <div className="trace-records-heading">
      <div><p className="eyebrow">RECORDED ACTIVITY</p><h2 id="session-list-title">Session records</h2><p>Each entry opens the captured conversation, tools, and review signal.</p></div>
      <div className="trace-records-count"><strong>{visibleSessions.length.toLocaleString()}</strong><span>of {sessions.length.toLocaleString()} records</span></div>
    </div>
    <div className="trace-record-controls">
      <Field className="trace-search-field">
        <FieldLabel>Search sessions</FieldLabel>
        <div className="trace-search-group">
          <Input
            type="search"
            className="trace-search-input"
            ref={searchInputRef}
            value={query}
            onValueChange={onQueryChange}
            placeholder="Title, ID, event count, status"
          />
          {query && <Button className="trace-search-clear" aria-label="Clear search" onClick={() => { onQueryChange(''); searchInputRef.current?.focus() }}>×</Button>}
        </div>
      </Field>
      <Field className="trace-filter-field">
        <FieldLabel>Filter sessions</FieldLabel>
        <SegmentedControl className="trace-filter-control" aria-label="Filter sessions" value={filter} onValueChange={onFilterChange}>
          <SegmentedControlIndicator />
          {filters.map((option) => <SegmentedControlItem value={option.id} key={option.id}>{option.label}</SegmentedControlItem>)}
        </SegmentedControl>
      </Field>
      <Field className="trace-sort-field">
        <FieldLabel>Sort by</FieldLabel>
        <Select value={sortBy} onValueChange={onSortChange}>
          <SelectTrigger className="trace-sort-trigger"><SelectValue /></SelectTrigger>
          <SelectContent className="trace-sort-options">
            <SelectItem value="recent">Most recent</SelectItem>
            <SelectItem value="tools">Most tool calls</SelectItem>
            <SelectItem value="events">Most events</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
    {visibleSessions.length ? <ul className="session-record-list" aria-label="Trace sessions">
      {visibleSessions.map((session) => <SessionRecord key={session.id} session={session} selected={selectedId === session.id} onSelect={onSelect} />)}
    </ul> : <div className="session-empty-state" role="status">
      <span className="session-empty-state__mark" aria-hidden="true">∅</span>
      <div><p className="eyebrow">{hasFilters ? 'FILTER RESULT' : 'SESSION STORE'}</p>
        <h3>{hasFilters ? 'No sessions match your filters.' : 'No sessions captured yet.'}</h3>
        <p>{hasFilters ? 'Adjust the search or status filter to see other records.' : 'New authenticated traces will appear here after session events are sent to Nala Trace.'}</p>
        {hasFilters ? <Button className="button--quiet" onClick={resetFilters}>Clear filters</Button> : <Button className="button--quiet" onClick={onRetry}>Refresh records</Button>}
      </div>
    </div>}
    <div className="trace-records-foot"><span>Only summaries returned for this account are listed.</span><span>{visibleSessions.length.toLocaleString()} shown</span></div>
  </section>
}
