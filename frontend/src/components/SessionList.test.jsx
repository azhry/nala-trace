import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SessionList from './SessionList'
import { normalizeSessionSummaries } from '../sessionSummaries'

const sessions = normalizeSessionSummaries({
  sessions: [
    {
      session_id: 'session-a',
      title: 'Review the session title',
      first_event_at: '2026-08-18T08:00:00Z',
      last_event_at: '2026-08-18T08:05:00Z',
      event_count: 10,
      tool_call_count: 2,
      mcp_call_count: 3,
      mcp_servers: ['github', 'linear'],
      skill_invocation_count: 1,
      file_operation_count: 2,
    },
    {
      session_id: 'session-b',
      title: 'Investigate the flagged session',
      first_event_at: '2026-08-19T08:00:00Z',
      last_event_at: '2026-08-19T08:05:00Z',
      event_count: 30,
      tool_call_count: 8,
      mcp_call_count: 0,
      mcp_servers: [],
      skill_invocation_count: 0,
      file_operation_count: 5,
      evaluation_status: 'attention',
    },
  ],
})

function SessionListHarness({ sessions: sessionRows = sessions, selectedId = 'session-a', initialQuery = '', onSelect = vi.fn(), onQueryChange = vi.fn(), onFilterChange = vi.fn(), onSortChange = vi.fn(), onRetry }) {
  const [query, setQuery] = useState(initialQuery)
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('recent')
  return <SessionList sessions={sessionRows} selectedId={selectedId} onSelect={onSelect} query={query} onQueryChange={(value) => { onQueryChange(value); setQuery(value) }} filter={filter} onFilterChange={(value) => { onFilterChange(value); setFilter(value) }} sortBy={sortBy} onSortChange={(value) => { onSortChange(value); setSortBy(value) }} onRetry={onRetry} />
}

function renderList(overrides = {}) {
  return render(<SessionListHarness {...overrides} />)
}

function recordIds() {
  return [...document.querySelectorAll('.session-record__title strong')].map((node) => node.textContent)
}

describe('SessionList', () => {
  it('renders titles as primary labels and IDs as row metadata', () => {
    renderList()

    expect(screen.getByText('Review the session title')).toBeInTheDocument()
    expect(screen.getByText('session-a')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open session Review the session title (session-a)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open session Review the session title (session-a)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('8 tools')).toBeInTheDocument()
    expect(screen.getByLabelText('3 MCP calls')).toBeInTheDocument()
    expect(screen.getByLabelText('5 files')).toBeInTheDocument()
    expect(screen.getByLabelText('1 skills')).toBeInTheDocument()
    expect(screen.getByText('github · linear')).toBeInTheDocument()
    expect(screen.getByText('No MCP servers recorded')).toBeInTheDocument()
  })

  it('renders stable recency and metric ordering controls', async () => {
    const user = userEvent.setup()
    const onSortChange = vi.fn()
    renderList({ onSortChange })

    expect(recordIds()).toEqual(['Investigate the flagged session', 'Review the session title'])
    await user.click(screen.getByRole('combobox', { name: 'Sort by' }))
    await user.click(screen.getByRole('option', { name: 'Most tool calls' }))
    expect(onSortChange).toHaveBeenCalledWith('tools')
  })

  it('preserves selection while filters change and reports no matches', async () => {
    const user = userEvent.setup()
    const onQueryChange = vi.fn()
    const { rerender } = renderList({ onQueryChange })
    const search = screen.getByRole('searchbox', { name: 'Search sessions' })

    await user.type(search, 'files 5')
    expect(onQueryChange).toHaveBeenCalledWith('files 5')
    rerender(<SessionListHarness selectedId="session-b" onQueryChange={onQueryChange} />)
    expect(screen.getByRole('button', { name: 'Open session Investigate the flagged session (session-b)' })).toHaveAttribute('aria-pressed', 'true')

    await user.clear(screen.getByRole('searchbox', { name: 'Search sessions' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search sessions' }), 'missing')
    expect(screen.getByText('No sessions match your filters.')).toBeInTheDocument()
  })

  it('keeps legacy summaries without a title readable and navigable by ID', () => {
    const legacySessions = normalizeSessionSummaries({
      sessions: [{ session_id: 'legacy-session', event_count: 1 }],
    })
    const onSelect = vi.fn()

    renderList({ sessions: legacySessions, selectedId: null, onSelect })

    const row = screen.getByRole('button', { name: 'Open session legacy-session' })
    expect(row).toBeInTheDocument()
    expect(screen.getAllByText('legacy-session')).toHaveLength(2)
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith('legacy-session')
  })
})
