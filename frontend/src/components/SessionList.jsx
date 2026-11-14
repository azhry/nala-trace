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
  return <span className={'record-status record-status--' + status}><span />{statusLabel(status)}</span>
}

function formatDate(value) {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function sessionTitle(session) {
  return typeof session.title === 'string' && session.title.trim() ? session.title.trim() : session.id || 'Untitled session'
}

function statusLabel(status) {
  return status === 'attention' ? 'Needs review' : status === 'passed' ? 'Passed' : 'Captured'
}

function sessionAccessibleLabel(session) {
  const title = sessionTitle(session)
  const identity = title === session.id ? title : title + ' (' + session.id + ')'
  return `Open session ${identity}. ${statusLabel(session.status)}. Last activity ${formatDate(session.lastEventAt)}.`
}

function SessionRecord({ session, selected, onSelect }) {
  const title = sessionTitle(session)
  const hasDistinctTitle = title !== session.id
  return <li className="session-record-item">
    <Button
      className={'session-record' + (selected ? ' is-selected' : '')}
      aria-label={sessionAccessibleLabel(session)}
      aria-pressed={selected}
      onClick={() => onSelect(session.id)}
    >
      <span className="session-record__identity">
        <span className="session-record__title"><strong>{title}</strong><StatusBadge status={session.status} /></span>
        {hasDistinctTitle && <code>{session.id}</code>}
      </span>
      <span className="session-record__event"><small>Last activity</small><time dateTime={session.lastEventAt || undefined}>{formatDate(session.lastEventAt)}</time></span>
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
  const hasSearch = Boolean(query.trim())
  const hasFilters = hasSearch || filter !== 'all'
  const hasNoSavedSessions = sessions.length === 0 && !hasSearch
  const hasNoReviewSessions = sessions.length > 0 && visibleSessions.length === 0 && filter === 'attention' && !hasSearch
  const resetFilters = () => {
    onQueryChange('')
    onFilterChange('all')
  }

  return <section className="trace-records-panel" aria-labelledby="session-list-title">
    <div className="trace-records-heading">
      <div><h2 id="session-list-title">Browse sessions</h2></div>
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
            placeholder="Title, ID, status, or counts"
          />
          {query && <Button className="trace-search-clear" aria-label="Clear search text" onClick={() => { onQueryChange(''); searchInputRef.current?.focus() }}>×</Button>}
        </div>
      </Field>
      <Field className="trace-filter-field">
        <FieldLabel>Filter sessions</FieldLabel>
        <SegmentedControl className="trace-filter-control" aria-label="Filter sessions" aria-describedby="needs-review-filter-help" value={filter} onValueChange={onFilterChange}>
          <SegmentedControlIndicator />
          {filters.map((option) => <SegmentedControlItem value={option.id} key={option.id}>{option.label}</SegmentedControlItem>)}
        </SegmentedControl>
        <small id="needs-review-filter-help" className="trace-filter-help">Needs review includes saved evaluations marked for attention, failure, or error.</small>
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
      <div>
        <h3>{hasNoSavedSessions ? 'No sessions yet.' : hasNoReviewSessions ? 'No sessions currently need review.' : hasSearch ? 'No sessions match your search.' : 'No sessions match this filter.'}</h3>
        <p>{hasNoSavedSessions
          ? 'Send an authenticated trace to Nala Trace, then refresh.'
          : hasNoReviewSessions
            ? 'Saved evaluations marked for attention, failure, or error appear here.'
            : hasSearch
              ? 'Try a different title or session ID.'
              : 'Show all sessions to see the other saved evaluations.'}</p>
        {hasNoSavedSessions
          ? <Button className="button--quiet" onClick={onRetry}>Refresh sessions</Button>
          : hasNoReviewSessions
            ? <Button className="button--quiet" onClick={() => onFilterChange('all')}>Show all sessions</Button>
            : hasFilters
              ? <Button className="button--quiet" onClick={resetFilters}>{hasSearch && filter !== 'all' ? 'Clear search and filters' : hasSearch ? 'Clear search' : 'Show all sessions'}</Button>
              : null}
      </div>
    </div>}
    <div className="trace-records-foot"><span>Only sessions available to this account are shown.</span></div>
  </section>
}
